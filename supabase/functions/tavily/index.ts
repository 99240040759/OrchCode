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

  try {
    const { query, domain, maxResults } = await req.json();
    const apiKey = Deno.env.get("TAVILY_API_KEY");
    if (!apiKey) {
      throw new Error("Server Configuration Error: TAVILY_API_KEY is missing.");
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        include_domains: domain ? [domain] : undefined,
        include_answer: true,
        max_results: maxResults ?? 5,
      }),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
