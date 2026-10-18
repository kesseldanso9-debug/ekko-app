create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  visibility text not null default 'signed_in'
    check (visibility in ('signed_in', 'friends')),
  profile_photo_path text,
  profile_video_path text,
  background_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_pending_pair
  on public.friend_requests (sender_id, receiver_id)
  where status = 'pending';

create table if not exists public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create or replace function public.create_ekko_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := lower(trim(new.raw_user_meta_data ->> 'username'));
begin
  if requested_username is null
    or requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 letters, numbers, or underscores.';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists ekko_auth_user_created on auth.users;
create trigger ekko_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_ekko_profile();

create or replace function public.ekko_are_friends(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where (f.user_a = first_user and f.user_b = second_user)
       or (f.user_a = second_user and f.user_b = first_user)
  );
$$;

revoke all on function public.ekko_are_friends(uuid, uuid) from public;
grant execute on function public.ekko_are_friends(uuid, uuid) to authenticated;

create or replace function public.search_ekko_profiles(search_text text)
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username
  from public.profiles p
  where auth.uid() is not null
    and length(trim(search_text)) >= 2
    and position(lower(trim(search_text)) in p.username) > 0
    and p.id <> auth.uid()
  order by p.username
  limit 20;
$$;

revoke all on function public.search_ekko_profiles(text) from public;
grant execute on function public.search_ekko_profiles(text) to authenticated;

create or replace function public.get_ekko_relationships()
returns table (id uuid, username text, relationship text, request_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, 'incoming'::text, r.id
  from public.friend_requests r
  join public.profiles p on p.id = r.sender_id
  where r.receiver_id = auth.uid() and r.status = 'pending'
  union all
  select p.id, p.username, 'outgoing'::text, r.id
  from public.friend_requests r
  join public.profiles p on p.id = r.receiver_id
  where r.sender_id = auth.uid() and r.status = 'pending'
  union all
  select p.id, p.username, 'friend'::text, null::uuid
  from public.friendships f
  join public.profiles p on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where f.user_a = auth.uid() or f.user_b = auth.uid()
  order by username;
$$;

revoke all on function public.get_ekko_relationships() from public;
grant execute on function public.get_ekko_relationships() to authenticated;

create or replace function public.add_ekko_friendship_from_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_user uuid;
  second_user uuid;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    first_user := least(new.sender_id, new.receiver_id);
    second_user := greatest(new.sender_id, new.receiver_id);
    insert into public.friendships (user_a, user_b)
    values (first_user, second_user)
    on conflict do nothing;
    delete from public.friend_requests
    where sender_id = new.receiver_id
      and receiver_id = new.sender_id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists ekko_friend_request_accepted on public.friend_requests;
create trigger ekko_friend_request_accepted
  after update of status on public.friend_requests
  for each row execute procedure public.add_ekko_friendship_from_request();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

grant select on public.profiles to authenticated;
grant update (visibility, profile_photo_path, profile_video_path, background_path)
  on public.profiles to authenticated;
grant select, insert, update (status), delete on public.friend_requests to authenticated;
grant select, delete on public.friendships to authenticated;

drop policy if exists "Profiles visible to their owner, signed-in users, or friends" on public.profiles;
create policy "Profiles visible to their owner, signed-in users, or friends"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or visibility = 'signed_in'
    or public.ekko_are_friends((select auth.uid()), id)
  );

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (profile_photo_path is null or left(profile_photo_path, length(id::text) + 1) = id::text || '/')
    and (profile_video_path is null or left(profile_video_path, length(id::text) + 1) = id::text || '/')
    and (background_path is null or left(background_path, length(id::text) + 1) = id::text || '/')
  );

drop policy if exists "Users read their own friend requests" on public.friend_requests;
create policy "Users read their own friend requests"
  on public.friend_requests for select to authenticated
  using (sender_id = (select auth.uid()) or receiver_id = (select auth.uid()));

drop policy if exists "Users send friend requests" on public.friend_requests;
create policy "Users send friend requests"
  on public.friend_requests for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and receiver_id <> (select auth.uid())
    and status = 'pending'
  );

drop policy if exists "Recipients respond to pending requests" on public.friend_requests;
create policy "Recipients respond to pending requests"
  on public.friend_requests for update to authenticated
  using (receiver_id = (select auth.uid()) and status = 'pending')
  with check (
    receiver_id = (select auth.uid())
    and status in ('accepted', 'declined')
  );

drop policy if exists "Senders cancel pending requests" on public.friend_requests;
create policy "Senders cancel pending requests"
  on public.friend_requests for delete to authenticated
  using (sender_id = (select auth.uid()) and status = 'pending');

drop policy if exists "Users read their friendships" on public.friendships;
create policy "Users read their friendships"
  on public.friendships for select to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

drop policy if exists "Users remove their friendships" on public.friendships;
create policy "Users remove their friendships"
  on public.friendships for delete to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ekko-media',
  'ekko-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Visible profile media is readable by authorized users" on storage.objects;
create policy "Visible profile media is readable by authorized users"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ekko-media'
    and exists (
      select 1
      from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.id = (select auth.uid())
          or p.visibility = 'signed_in'
          or public.ekko_are_friends((select auth.uid()), p.id)
        )
    )
  );

drop policy if exists "Users upload media to their own folder" on storage.objects;
create policy "Users upload media to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ekko-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete media from their own folder" on storage.objects;
create policy "Users delete media from their own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ekko-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
