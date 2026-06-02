import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createHandler, jsonResponse, errorResponse } from "../_shared/handler.ts";

// HIGH-11 FIX: Added strict input validation — previously query/domain/maxResults
// had zero validation, allowing empty queries, malicious domains, and maxResults=10000.
const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_LIMIT = 10;
const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

serve(createHandler(async (req, env) => {
  const tavilyKey = env["TAVILY_API_KEY"];
  if (!tavilyKey) {
    return errorResponse("Server Configuration Error: TAVILY_API_KEY is missing.", 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const { query, domain, maxResults } = body;

  // Validate query
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return errorResponse("'query' is required and must be a non-empty string.", 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(`'query' must not exceed ${MAX_QUERY_LENGTH} characters.`, 400);
  }

  // Validate domain (optional)
  if (domain !== undefined && domain !== null) {
    if (typeof domain !== "string" || !DOMAIN_PATTERN.test(domain)) {
      return errorResponse("'domain' must be a valid domain name (e.g. example.com).", 400);
    }
  }

  // Validate maxResults — cap at 10 to prevent billing abuse
  const resolvedMaxResults = Math.min(
    Math.max(1, Number.isInteger(maxResults) ? maxResults : 5),
    MAX_RESULTS_LIMIT
  );

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: query.trim(),
      include_domains: domain ? [domain] : undefined,
      include_answer: true,
      max_results: resolvedMaxResults,
    }),
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}));
