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

  const gemini = { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" }
  const gemma = { id: "gemma-4-26b-a4b-it", name: "Gemma 4" }

  return new Response(JSON.stringify({ gemini, gemma }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
