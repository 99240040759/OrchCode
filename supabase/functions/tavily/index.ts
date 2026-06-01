import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { validateAnonKey } from "../_shared/auth.ts";

const ALLOWED_ORIGIN = "app://orch-code";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const expectedAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';

  if (!expectedAnonKey) {
    return new Response("Server Configuration Error: SUPABASE_ANON_KEY is missing.", { status: 500, headers: corsHeaders });
  }

  if (!validateAnonKey(req, expectedAnonKey, projectRef)) {
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
