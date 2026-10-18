# Ekko setup

Ekko's notes and local chats still work on the device. Accounts, friend requests,
profile media, and wallpapers use Supabase; they are not provided by GitHub Pages.

## 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com). In **Project Settings
→ API**, copy the project URL and the publishable key (or legacy `anon` key).
The publishable/anon key is intended for the browser; never put the
`service_role` key in this app.

In **Authentication → URL Configuration**, set the Site URL and redirect URL
to `https://kesseldanso9-debug.github.io/ekko-app/`. Email confirmation is
currently disabled so users can sign in immediately without a custom SMTP
provider. Set the minimum password length to 12.

Configure a transactional email provider under **Authentication → SMTP
Settings** so people can receive confirmation and password-reset emails.
Supabase's default email sender is intended for testing and is restricted;
email providers' free-tier limits vary.

## 2. Create Ekko's tables and private media bucket

Open **SQL Editor** in Supabase, paste the contents of `supabase/schema.sql`,
and run it. This creates the profile and friend-request tables, row-level
security rules, and a private `ekko-media` bucket limited to 50 MB per file.

## 3. Configure username sign-in

The `username-login` function is deployed in the Supabase project. Its JWT
gateway verification is disabled because the function handles password
validation itself. The project secret `EKKO_ALLOWED_ORIGIN` is set to the
GitHub Pages origin, and the service-role key remains on Supabase.

For future function changes, install the
[Supabase CLI](https://supabase.com/docs/guides/cli/getting-started), then run
these commands from this folder:

```text
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy username-login --no-verify-jwt
supabase secrets set EKKO_ALLOWED_ORIGIN=https://kesseldanso9-debug.github.io
```

`EKKO_ALLOWED_ORIGIN` is only the site origin: do not include the repository
path or a trailing slash. The Edge Function uses Supabase's server-side
`SUPABASE_SERVICE_ROLE_KEY` to look up usernames. That key must remain in
Supabase and must never be copied into a browser file or GitHub.

## 4. Add the public browser configuration

The public browser config is already set in `supabase-config.js`:

```js
window.EKKO_SUPABASE_CONFIG = {
  url: "https://nqiwrzqsfkixykpkulmd.supabase.co",
  anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  loginFunctionUrl: "https://nqiwrzqsfkixykpkulmd.supabase.co/functions/v1/username-login"
};
```

The publishable/anon key is public by design; the SQL policies protect the
data. Never replace it with the `service_role` key.

## 5. Publish the app

The app is published at
[`https://kesseldanso9-debug.github.io/ekko-app/`](https://kesseldanso9-debug.github.io/ekko-app/).
GitHub Pages deploys the `main` branch root. People create an account with
email, username, and password, then sign in immediately with their username or
email and password. Password reset links still require email delivery;
configure custom SMTP for reliable delivery.

Profile photos, profile videos, and wallpaper photos/videos are private
Supabase Storage objects. Users can choose whether these are visible to all
signed-in users or accepted friends only, and can send and accept friend
requests by username.

Supabase free-tier projects have storage and bandwidth limits and may be paused
after inactivity. Existing notes and chats remain local to each device; this
setup does not make them shared.
