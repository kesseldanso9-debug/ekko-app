import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedOrigin = Deno.env.get("EKKO_ALLOWED_ORIGIN")!;

const jsonHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Content-Type": "application/json"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: jsonHeaders
    });
  }
  if (request.headers.get("origin") !== allowedOrigin) {
    return new Response(JSON.stringify({ error: "Request origin is not allowed." }), {
      status: 403,
      headers: jsonHeaders
    });
  }

  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 12 || password.length > 128) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 400,
        headers: jsonHeaders
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const auth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: jsonHeaders
      });
    }

    const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id);
    if (accountError) throw accountError;
    const email = account.user?.email;
    if (!email) throw new Error("The account has no email address.");

    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return new Response(JSON.stringify({ error: "Invalid username or password, or email not confirmed." }), {
        status: 401,
        headers: jsonHeaders
      });
    }

    return new Response(JSON.stringify({ session: data.session }), {
      status: 200,
      headers: jsonHeaders
    });
  } catch (error) {
    console.error("Ekko username sign-in failed:", error);
    return new Response(JSON.stringify({ error: "Sign-in could not be completed. Please try again." }), {
      status: 500,
      headers: jsonHeaders
    });
  }
});
