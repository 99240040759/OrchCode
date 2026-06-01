import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Only allow requests from the Electron app origin.
// In Electron, loaded pages use app:// scheme. Supabase preflight will check this.
const ALLOWED_ORIGIN = "app://orch-code";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isValidLegacyJWT(token: string, projectRef: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload.iss === 'supabase' && payload.ref === projectRef && payload.role === 'anon';
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Validate the Supabase anon key — supports either the new publishable key or the legacy JWT anon key format.
  const authHeader = req.headers.get("Authorization");
  const apiKeyHeader = req.headers.get("apikey");
  const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';

  if (!expectedAnonKey) {
    return new Response("Server Configuration Error: SUPABASE_ANON_KEY is missing.", { status: 500, headers: corsHeaders });
  }

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (apiKeyHeader) {
    token = apiKeyHeader;
  }

  const hasValidAuth = (token === expectedAnonKey) || (projectRef && isValidLegacyJWT(token, projectRef));
  if (!hasValidAuth) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Forward to official Google Gemini API endpoint
  const subpath = url.pathname.replace(/^\/(functions\/v1\/)?gemini/, "");
  const targetUrl = `https://generativelanguage.googleapis.com${subpath}${url.search}`;

  const apiKey = Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) {
    return new Response("Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.", { status: 500, headers: corsHeaders });
  }

  const cleanHeaders = new Headers();
  cleanHeaders.set("x-goog-api-key", apiKey);

  const contentType = req.headers.get("content-type") || req.headers.get("Content-Type");
  if (contentType) {
    cleanHeaders.set("Content-Type", contentType);
  }

  const accept = req.headers.get("accept") || req.headers.get("Accept");
  if (accept) {
    cleanHeaders.set("Accept", accept);
  }

  try {
    const res = await fetch(targetUrl, {
      method: req.method,
      headers: cleanHeaders,
      body: req.body,
    });

    const resHeaders = new Headers(res.headers);
    Object.keys(corsHeaders).forEach((key) => {
      resHeaders.set(key, corsHeaders[key]);
    });

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
