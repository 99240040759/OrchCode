import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createHandler, jsonResponse, errorResponse } from "../_shared/handler.ts";

// MED-6 FIX: Model IDs/names now read from environment variables,
// no longer hardcoded. Change models without redeploying the function.
// Set GEMINI_MODEL_ID, GEMINI_MODEL_NAME, GEMMA_MODEL_ID, GEMMA_MODEL_NAME in Supabase secrets.
const DEFAULT_GEMINI_ID = "gemini-2.5-flash-preview-05-20";
const DEFAULT_GEMINI_NAME = "Gemini 2.5 Flash";
const DEFAULT_GEMMA_ID = "gemma-3-27b-it";
const DEFAULT_GEMMA_NAME = "Gemma 3 27B";

serve(createHandler(async (_req, env) => {
  const gemini = {
    id: env["GEMINI_MODEL_ID"] || DEFAULT_GEMINI_ID,
    name: env["GEMINI_MODEL_NAME"] || DEFAULT_GEMINI_NAME,
  };
  const gemma = {
    id: env["GEMMA_MODEL_ID"] || DEFAULT_GEMMA_ID,
    name: env["GEMMA_MODEL_NAME"] || DEFAULT_GEMMA_NAME,
  };

  return jsonResponse({ gemini, gemma });
}));
