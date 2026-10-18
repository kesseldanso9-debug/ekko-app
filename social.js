(() => {
  const container = document.getElementById("profile");
  const config = window.EKKO_SUPABASE_CONFIG;
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  const allowedTypes = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm", "video/quicktime"
  ]);
  const mediaUrls = new Set();
  let supabaseClient = null;
  let renderSequence = 0;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  const releaseMediaUrls = () => {
    mediaUrls.forEach(url => URL.revokeObjectURL(url));
    mediaUrls.clear();
  };

  const showMessage = (element, text, isError = false) => {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("profile-error", isError);
  };

  const friendlyError = (error) => {
    const message = error?.message || "Something went wrong. Please try again.";
    if (/duplicate key|unique constraint|already registered/i.test(message)) {
      return "That username or email is already in use.";
    }
    if (/row-level security|permission denied|not allowed/i.test(message)) {
      return "You don't have permission to do that. Check your friendship and profile visibility.";
    }
    return message;
  };

  const readyClient = () => {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase?.createClient) throw new Error("Ekko's account service could not load. Check your internet connection and refresh.");
    if (!config?.url || config.url.includes("YOUR_PROJECT_REF")
      || !config.anonKey || config.anonKey.includes("YOUR_SUPABASE")
      || !config.loginFunctionUrl || config.loginFunctionUrl.includes("YOUR_PROJECT_REF")) {
      throw new Error("Connect a Supabase project first by filling in supabase-config.js. Follow the setup guide in this folder.");
    }
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    return supabaseClient;
  };

  const fetchRelationships = async (client) => {
    const { data, error } = await client.rpc("get_ekko_relationships");
    if (error) throw error;
    return data || [];
  };

  const downloadMedia = async (client, path) => {
    if (!path) return null;
    const { data, error } = await client.storage.from("ekko-media").download(path);
    if (error) throw error;
    const url = URL.createObjectURL(data);
    mediaUrls.add(url);
    return { url, type: data.type };
  };

  const mediaElement = (media, alt, className = "profile-media") => {
    if (!media) return `<div class="empty">No media uploaded yet.</div>`;
    return media.type.startsWith("video/")
      ? `<video class="${className}" controls playsinline preload="metadata" src="${escapeHtml(media.url)}"></video>`
      : `<img class="${className}" src="${escapeHtml(media.url)}" alt="${escapeHtml(alt)}">`;
  };

  const profileMediaMarkup = async (client, profile, title, sequence) => {
    const [photo, video, background] = await Promise.all([
      downloadMedia(client, profile.profile_photo_path),
      downloadMedia(client, profile.profile_video_path),
      downloadMedia(client, profile.background_path)
    ]);
    if (sequence !== renderSequence) return "";
    const username = escapeHtml(profile.username);
    const backgroundMarkup = background
      ? background.type.startsWith("video/")
        ? `<div class="profile-background"><video class="profile-media" controls playsinline loop muted preload="metadata" src="${escapeHtml(background.url)}"></video></div>`
        : `<div class="profile-background"><img class="profile-media" src="${escapeHtml(background.url)}" alt="${username}'s wallpaper"></div>`
      : `<p class="empty">No wallpaper uploaded.</p>`;
    return `<article class="profile-card"><h2>${escapeHtml(title)}</h2>
      <div class="profile-person">${photo ? mediaElement(photo, `${username}'s profile photo`) : `<span class="friend-avatar">${escapeHtml(username.charAt(0).toUpperCase())}</span>`}<strong>@${username}</strong></div>
      <div class="profile-grid"><div><h3>Profile video</h3>${video ? mediaElement(video, `${username}'s profile video`) : `<p class="empty">No profile video uploaded.</p>`}</div>
      <div><h3>Wallpaper</h3>${backgroundMarkup}</div></div></article>`;
  };

  const authMarkup = () => `<div class="page-intro"><div class="eyebrow">Your Ekko account</div><h2>Make it yours</h2><p>Create an account to set up your profile, add a wallpaper, and find friends by username.</p></div>
    <div class="profile-grid"><section class="profile-auth"><h2>Sign in</h2><form class="profile-form" id="ekkoLogin">
      <label>Username or email<input name="login" type="text" maxlength="254" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Sign in</button><p class="profile-message" id="loginMessage" aria-live="polite"></p>
    </form><form class="profile-form" id="ekkoPasswordReset"><label>Forgot your password? Enter your account email<input name="email" type="email" autocomplete="email" required></label><button class="secondary-button" type="submit">Send password reset link</button><p class="profile-message" id="resetMessage" aria-live="polite"></p></form></section><section class="profile-auth"><h2>Create account</h2><form class="profile-form" id="ekkoSignup">
      <label>Email<input name="email" type="email" maxlength="254" autocomplete="email" required></label>
      <label>Username<input name="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
      <button class="primary" type="submit">Create account</button><p class="profile-message" id="signupMessage" aria-live="polite"></p>
    </form></section></div><p class="local-note">Use a unique username (3–24 letters, numbers, or underscores) and a password with at least 12 characters. You can sign in as soon as your account is created.</p>`;

  const bindAuthForms = (client) => {
    document.getElementById("ekkoSignup").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.getElementById("signupMessage");
      const values = new FormData(form);
      const username = String(values.get("username")).trim().toLowerCase();
      showMessage(message, "Creating your account…");
      try {
        const { data, error } = await client.auth.signUp({
          email: String(values.get("email")).trim(),
          password: String(values.get("password")),
          options: { data: { username }, emailRedirectTo: window.location.href.split("#")[0] }
        });
        if (error) throw error;
        form.reset();
        showMessage(message, data.session
          ? "Account created. You're signed in."
          : "Account created. Sign in with your username or email.");
        if (data.session) await renderProfile();
      } catch (error) {
        showMessage(message, friendlyError(error), true);
      }
    });

    document.getElementById("ekkoLogin").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.getElementById("loginMessage");
      const values = new FormData(form);
      const login = String(values.get("login")).trim();
      const password = String(values.get("password"));
      showMessage(message, "Signing in…");
      try {
        if (login.includes("@")) {
          const { data, error } = await client.auth.signInWithPassword({ email: login, password });
          if (error) throw error;
          if (!data.session) throw new Error("Sign-in did not return a session.");
        } else {
          const { data, error } = await client.functions.invoke("username-login", {
            body: { username: login, password }
          });
          if (error) throw error;
          if (!data?.session?.access_token || !data?.session?.refresh_token) {
            throw new Error("Username sign-in did not return a valid session.");
          }
          const { error: sessionError } = await client.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
          });
          if (sessionError) throw sessionError;
        }
        form.reset();
        await renderProfile();
      } catch (error) {
        let errorMessage = friendlyError(error);
        const response = error?.context;
        if (typeof response?.clone === "function") {
          const responseBody = await response.clone().json().catch(() => null);
          if (typeof responseBody?.error === "string") errorMessage = responseBody.error;
        }
        showMessage(message, errorMessage, true);
      }
    });

    document.getElementById("ekkoPasswordReset").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.getElementById("resetMessage");
      const email = String(new FormData(form).get("email")).trim();
      showMessage(message, "Sending reset email…");
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href.split("#")[0]
        });
        if (error) throw error;
        form.reset();
        showMessage(message, "If that email belongs to an account, a password reset link will arrive shortly.");
      } catch (error) {
        showMessage(message, friendlyError(error), true);
      }
    });
  };

  const renderPasswordRecovery = () => {
    renderSequence++;
    releaseMediaUrls();
    container.innerHTML = `<section class="profile-auth"><h2>Choose a new password</h2><form class="profile-form" id="ekkoNewPassword">
      <label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
      <button class="primary" type="submit">Update password</button><p class="profile-message" id="newPasswordMessage" aria-live="polite"></p>
    </form></section>`;
    document.getElementById("ekkoNewPassword").onsubmit = async event => {
      event.preventDefault();
      const password = String(new FormData(event.currentTarget).get("password"));
      const message = document.getElementById("newPasswordMessage");
      showMessage(message, "Updating password…");
      try {
        const { error } = await readyClient().auth.updateUser({ password });
        if (error) throw error;
        showMessage(message, "Password updated. You're signed in.");
        window.setTimeout(renderProfile, 800);
      } catch (error) {
        showMessage(message, friendlyError(error), true);
      }
    };
  };

  const relationshipsMarkup = (relationships) => {
    const incoming = relationships.filter(item => item.relationship === "incoming");
    const outgoing = relationships.filter(item => item.relationship === "outgoing");
    const friends = relationships.filter(item => item.relationship === "friend");
    const incomingMarkup = incoming.length ? incoming.map(item => `<div class="profile-list-item"><span>@${escapeHtml(item.username)}<small>Friend request</small></span><span class="profile-actions"><button class="secondary-button" data-request-action="accepted" data-request-id="${escapeHtml(item.request_id)}">Accept</button><button class="secondary-button" data-request-action="declined" data-request-id="${escapeHtml(item.request_id)}">Decline</button></span></div>`).join("") : `<p class="empty">No incoming requests.</p>`;
    const outgoingMarkup = outgoing.length ? outgoing.map(item => `<div class="profile-list-item"><span>@${escapeHtml(item.username)}<small>Request pending</small></span><button class="secondary-button" data-cancel-request="${escapeHtml(item.request_id)}">Cancel</button></div>`).join("") : `<p class="empty">No pending requests.</p>`;
    const friendsMarkup = friends.length ? friends.map(item => `<div class="profile-list-item"><span>@${escapeHtml(item.username)}</span><span class="profile-actions"><button class="secondary-button" data-view-profile="${escapeHtml(item.id)}">View profile</button><button class="secondary-button" data-remove-friend="${escapeHtml(item.id)}">Remove</button></span></div>`).join("") : `<p class="empty">No friends yet. Search by username to find people.</p>`;
    return { incomingMarkup, outgoingMarkup, friendsMarkup, incoming, outgoing, friends };
  };

  const bindProfileActions = (client, user, relationships) => {
    const message = document.getElementById("profileMessage");
    document.getElementById("ekkoSignout").onclick = async () => {
      const { error } = await client.auth.signOut();
      if (error) showMessage(message, friendlyError(error), true);
      else await renderProfile();
    };

    document.getElementById("visibility").onchange = async event => {
      showMessage(message, "Saving visibility…");
      const { error } = await client.from("profiles").update({ visibility: event.target.value }).eq("id", user.id);
      if (error) showMessage(message, friendlyError(error), true);
      else showMessage(message, "Profile visibility saved.");
    };

    document.getElementById("usernameSearch").onsubmit = async event => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get("query")).trim().toLowerCase();
      const results = document.getElementById("searchResults");
      results.textContent = "Searching…";
      try {
        const { data, error } = await client.rpc("search_ekko_profiles", { search_text: query });
        if (error) throw error;
        const pendingIds = new Set(relationships.filter(item => item.relationship !== "friend").map(item => item.id));
        const friendIds = new Set(relationships.filter(item => item.relationship === "friend").map(item => item.id));
        results.innerHTML = data?.length ? data.map(item => {
          const button = friendIds.has(item.id)
            ? `<button class="secondary-button" data-view-profile="${escapeHtml(item.id)}">View profile</button>`
            : pendingIds.has(item.id)
              ? `<span class="privacy-note">Request already pending</span>`
              : `<button class="secondary-button" data-send-request="${escapeHtml(item.id)}">Add friend</button>`;
          return `<div class="profile-list-item"><span>@${escapeHtml(item.username)}</span><span class="profile-actions">${button}</span></div>`;
        }).join("") : `<p class="empty">No matching usernames. Try at least two characters.</p>`;
        bindSocialButtons(client, user, message);
      } catch (error) {
        results.textContent = friendlyError(error);
      }
    };

    document.querySelectorAll("[data-request-action]").forEach(button => {
      button.onclick = async () => {
        const { error } = await client.from("friend_requests")
          .update({ status: button.dataset.requestAction })
          .eq("id", button.dataset.requestId);
        if (error) showMessage(message, friendlyError(error), true);
        else await renderProfile();
      };
    });

    document.querySelectorAll("[data-cancel-request]").forEach(button => {
      button.onclick = async () => {
        const { error } = await client.from("friend_requests").delete().eq("id", button.dataset.cancelRequest);
        if (error) showMessage(message, friendlyError(error), true);
        else await renderProfile();
      };
    });

    bindSocialButtons(client, user, message);
    document.getElementById("profileSettings").onsubmit = event => event.preventDefault();
    document.querySelectorAll("[data-profile-upload]").forEach(input => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!allowedTypes.has(file.type) || file.size > MAX_UPLOAD_BYTES) {
          showMessage(message, "Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file up to 50 MB.", true);
          input.value = "";
          return;
        }
        const slot = input.dataset.profileUpload;
        const pathColumn = {
          photo: "profile_photo_path",
          video: "profile_video_path",
          background: "background_path"
        }[slot];
        const extension = ({
          "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
          "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
        })[file.type];
        const newPath = `${user.id}/${slot}/${crypto.randomUUID()}.${extension}`;
        const previousPath = document.getElementById(`current-${slot}`).value || null;
        showMessage(message, "Uploading…");
        try {
          const { error: uploadError } = await client.storage.from("ekko-media").upload(newPath, file, {
            contentType: file.type,
            upsert: false
          });
          if (uploadError) throw uploadError;
          const { error: updateError } = await client.from("profiles")
            .update({ [pathColumn]: newPath })
            .eq("id", user.id);
          if (updateError) {
            const { error: cleanupError } = await client.storage.from("ekko-media").remove([newPath]);
            if (cleanupError) console.error("Ekko could not clean up an unlinked upload:", cleanupError);
            throw updateError;
          }
          if (previousPath) {
            const { error: cleanupError } = await client.storage.from("ekko-media").remove([previousPath]);
            if (cleanupError) {
              console.error("Ekko could not remove replaced media:", cleanupError);
              showMessage(message, "Upload saved, but the previous file could not be removed. Contact support if it remains.", true);
              return;
            }
          }
          await renderProfile();
        } catch (error) {
          showMessage(message, friendlyError(error), true);
        } finally {
          input.value = "";
        }
      };
    });
  };

  const bindSocialButtons = (client, user, message) => {
    document.querySelectorAll("[data-send-request]").forEach(button => {
      button.onclick = async () => {
        const { error } = await client.from("friend_requests").insert({
          sender_id: user.id,
          receiver_id: button.dataset.sendRequest
        });
        if (error) showMessage(message, error.code === "23505"
          ? "A friend request is already pending."
          : friendlyError(error), true);
        else await renderProfile();
      };
    });

    document.querySelectorAll("[data-remove-friend]").forEach(button => {
      button.onclick = async () => {
        const otherId = button.dataset.removeFriend;
        const { error } = await client.from("friendships").delete().or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
          .or(`user_a.eq.${otherId},user_b.eq.${otherId}`);
        if (error) showMessage(message, friendlyError(error), true);
        else await renderProfile();
      };
    });

    document.querySelectorAll("[data-view-profile]").forEach(button => {
      button.onclick = async () => {
        const target = document.getElementById("profileViewer");
        target.textContent = "Loading profile…";
        try {
          const { data, error } = await client.from("profiles")
            .select("id,username,profile_photo_path,profile_video_path,background_path")
            .eq("id", button.dataset.viewProfile)
            .single();
          if (error) throw error;
          target.innerHTML = await profileMediaMarkup(client, data, `@${data.username}`, renderSequence);
        } catch (error) {
          target.textContent = friendlyError(error);
        }
      };
    });
  };

  const signedInMarkup = (user, profile, relationships) => {
    const lists = relationshipsMarkup(relationships);
    const displayEmail = escapeHtml(user.email || "");
    return `<div class="page-intro"><div class="eyebrow">Your Ekko account</div><h2>@${escapeHtml(profile.username)}</h2><p>${displayEmail}</p><button class="secondary-button" id="ekkoSignout">Sign out</button></div>
      <section class="profile-card"><h2>Your profile</h2><p>Photos, videos, and wallpapers are visible to signed-in users by default. You can restrict them to accepted friends.</p>
      <label for="visibility">Who can view your profile media?</label><select id="visibility"><option value="signed_in"${profile.visibility === "signed_in" ? " selected" : ""}>Signed-in users</option><option value="friends"${profile.visibility === "friends" ? " selected" : ""}>Friends only</option></select>
      <form id="profileSettings"><input id="current-photo" type="hidden" value="${escapeHtml(profile.profile_photo_path || "")}"><input id="current-video" type="hidden" value="${escapeHtml(profile.profile_video_path || "")}"><input id="current-background" type="hidden" value="${escapeHtml(profile.background_path || "")}"></form>
      <div class="profile-grid"><label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-profile-upload="photo"></label>
      <label>Profile video<input type="file" accept="video/mp4,video/webm,video/quicktime" data-profile-upload="video"></label>
      <label>Wallpaper photo or video<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" data-profile-upload="background"></label></div>
      <p class="local-note">Each upload can be up to 50 MB. Media is stored in a private bucket and delivered only when its visibility rules allow access.</p>
      <div id="ownProfilePreview"></div><p class="profile-message" id="profileMessage" aria-live="polite"></p></section>
      <section class="profile-card"><h2>Find friends</h2><p>Search by username and send a request. The other person must accept it.</p>
      <form class="friend-form" id="usernameSearch"><input name="query" type="search" minlength="2" maxlength="24" placeholder="Search usernames" aria-label="Search usernames" required><button class="primary" type="submit">Search</button></form><div class="profile-list" id="searchResults"></div></section>
      <div class="profile-grid"><section class="profile-card"><h2>Friend requests</h2><h3>Incoming</h3><div class="profile-list">${lists.incomingMarkup}</div><h3>Sent</h3><div class="profile-list">${lists.outgoingMarkup}</div></section>
      <section class="profile-card"><h2>Your friends</h2><div class="profile-list">${lists.friendsMarkup}</div></section></div>
      <div id="profileViewer"></div><p class="local-note">Account passwords and email are managed by Supabase Auth. Your private notes and existing local chats remain stored on this device.</p>`;
  };

  async function renderProfile() {
    if (!container) return;
    const sequence = ++renderSequence;
    releaseMediaUrls();
    container.innerHTML = `<p class="empty">Loading your profile…</p>`;
    try {
      const client = readyClient();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) {
        if (sequence !== renderSequence) return;
        container.innerHTML = authMarkup();
        bindAuthForms(client);
        return;
      }

      const [{ data: profile, error: profileError }, relationships] = await Promise.all([
        client.from("profiles").select("id,username,visibility,profile_photo_path,profile_video_path,background_path").eq("id", user.id).single(),
        fetchRelationships(client)
      ]);
      if (profileError) throw profileError;
      if (sequence !== renderSequence) return;
      container.innerHTML = signedInMarkup(user, profile, relationships);
      bindProfileActions(client, user, relationships);
      try {
        const preview = await profileMediaMarkup(client, profile, "Profile preview", sequence);
        if (sequence === renderSequence) document.getElementById("ownProfilePreview").innerHTML = preview;
      } catch (error) {
        if (sequence === renderSequence) showMessage(document.getElementById("profileMessage"), friendlyError(error), true);
      }
    } catch (error) {
      if (sequence === renderSequence) {
        container.innerHTML = `<section class="profile-auth"><h2>Profile unavailable</h2><p class="profile-error">${escapeHtml(friendlyError(error))}</p><p>Check the Supabase setup guide and your connection, then try again.</p><button class="secondary-button" id="retryProfile">Try again</button></section>`;
        document.getElementById("retryProfile").onclick = renderProfile;
      }
    }
  }

  window.renderProfile = renderProfile;

  try {
    readyClient().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        document.getElementById("t-profile")?.click();
        window.setTimeout(renderPasswordRecovery, 0);
        return;
      }
      if (document.getElementById("t-profile")?.getAttribute("aria-selected") === "true") {
        window.setTimeout(renderProfile, 0);
      }
    });
  } catch (error) {
    if (!error.message.startsWith("Connect a Supabase project first")) {
      console.error("Ekko profile setup is unavailable:", error);
    }
  }
})();
