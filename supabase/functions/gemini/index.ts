import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createHandler, errorResponse } from "../_shared/handler.ts";
import { corsHeaders } from "../_shared/handler.ts";

// CRIT-5 FIX: Path allowlist — only specific Gemini model endpoints are proxied.
// Previously ANY path was forwarded to Google's API, making this a fully open proxy.
const ALLOWED_PATH_PATTERNS = [
  /^\/v1beta\/models$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[\/:]generateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[\/:]streamGenerateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[\/:]countTokens$/,
];

function isAllowedPath(subpath: string): boolean {
  return ALLOWED_PATH_PATTERNS.some((p) => p.test(subpath));
}

serve(createHandler(async (req, env) => {
  const apiKey = env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    return errorResponse("Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.", 500);
  }

  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/(functions\/v1\/)?gemini/, "");

  if (!isAllowedPath(subpath)) {
    return errorResponse(`Path not allowed: ${subpath}`, 403);
  }

  const targetUrl = `https://generativelanguage.googleapis.com${subpath}${url.search}`;

  // MED-10 FIX: Headers.get() is case-insensitive per Fetch spec — single lookup is correct
  const cleanHeaders = new Headers();
  cleanHeaders.set("x-goog-api-key", apiKey);
  const contentType = req.headers.get("content-type");
  if (contentType) cleanHeaders.set("Content-Type", contentType);
  const accept = req.headers.get("accept");
  if (accept) cleanHeaders.set("Accept", accept);

  const res = await fetch(targetUrl, {
    method: req.method,
    headers: cleanHeaders,
    body: req.body,
  });

  const resHeaders = new Headers(res.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v));

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
}));
