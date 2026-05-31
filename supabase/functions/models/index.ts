import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify Bearer Token is passed
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const gemini = { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" }
  const gemma = { id: "gemma-4-26b-a4b-it", name: "Gemma 4" }

  return new Response(JSON.stringify({ gemini, gemma }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
