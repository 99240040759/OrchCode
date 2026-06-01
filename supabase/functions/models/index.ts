import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Only allow requests from the Electron app origin.
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

  const gemini = { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" }
  const gemma = { id: "gemma-4-26b-a4b-it", name: "Gemma 4" }

  return new Response(JSON.stringify({ gemini, gemma }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
