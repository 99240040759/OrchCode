require('dotenv').config();
const functions = require('@google-cloud/functions-framework');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();

// Universal CORS — desktop sends app://orch-code, Android sends no origin / OkHttp UA
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: '*/*' }));

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const expectedAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!expectedAnonKey || !supabaseUrl)
    return res.status(500).json({ error: 'Server Configuration Error: Missing Supabase credentials.' });

  const apiKeyHeader = req.headers['apikey'];
  const authHeader = req.headers['authorization'];
  let clientKey = '';
  if (apiKeyHeader) clientKey = apiKeyHeader;
  else if (authHeader && authHeader.startsWith('Bearer ')) clientKey = authHeader.substring(7);

  if (!clientKey || !timingSafeEqual(clientKey.trim(), expectedAnonKey.trim()))
    return res.status(401).json({ error: 'Unauthorized API Client' });

  // Normalize path — strip /functions/v1/api or /api prefix for Supabase-compat calls
  let cleanPath = req.path.replace(/^\/functions\/v1\/api/, '').replace(/^\/api/, '');
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
  req.normalizedPath = cleanPath;

  // Public endpoints (no JWT required)
  const isPublic = cleanPath.endsWith('/models');
  if (isPublic) return next();

  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized User: Missing JWT' });

  try {
    const supabase = createClient(supabaseUrl, expectedAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return res.status(401).json({ error: 'Unauthorized User: Invalid JWT' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized User: Invalid JWT' });
  }
});

// ─── Key pool with rotation ───────────────────────────────────────────────────
const KEY_POOL = {};
function getApiKey(envName, triggerRotation = false) {
  const envVal = process.env[envName] || '';
  if (!envVal) return null;
  if (!KEY_POOL[envName]) {
    KEY_POOL[envName] = { keys: envVal.split(',').map(k => k.trim()).filter(Boolean), index: 0 };
  }
  const pool = KEY_POOL[envName];
  if (pool.keys.length === 0) return null;
  if (triggerRotation) pool.index = (pool.index + 1) % pool.keys.length;
  return { value: pool.keys[pool.index], pool };
}
function getApiKeyVal(envName) {
  const info = getApiKey(envName, false);
  return info ? info.value : '';
}

// ─── Proxy with key rotation ──────────────────────────────────────────────────
async function proxyRequestWithRotation(req, res, targetUrl, envName, isBearer, attempt = 1) {
  const keyInfo = getApiKey(envName, false);
  if (!keyInfo) return res.status(500).json({ error: `Server Configuration Error: ${envName} is missing.` });
  const headers = new Headers();
  if (isBearer) headers.set('Authorization', `Bearer ${keyInfo.value}`);
  else headers.set('x-goog-api-key', keyInfo.value);
  const forwardHeaders = ['content-type', 'accept', 'user-agent'];
  for (const h of forwardHeaders) { const val = req.headers[h]; if (val) headers.set(h, val); }
  let body = undefined;
  if (req.method === 'POST' || req.method === 'PUT')
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  try {
    const upstreamRes = await fetch(targetUrl, { method: req.method, headers, body: body || undefined });
    if (upstreamRes.status === 429 && attempt < keyInfo.pool.keys.length) {
      console.warn(`[rotator] 429 on ${envName}, rotating key`);
      getApiKey(envName, true);
      return proxyRequestWithRotation(req, res, targetUrl, envName, isBearer, attempt + 1);
    }
    res.status(upstreamRes.status);
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (k !== 'transfer-encoding' && k !== 'content-encoding') res.setHeader(k, v);
    }
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    if (upstreamRes.body) Readable.fromWeb(upstreamRes.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error(`Upstream proxy error: ${targetUrl}`, err);
    res.status(502).json({ error: `Upstream Proxy Error: ${err.message}` });
  }
}

// ─── Budget helpers ───────────────────────────────────────────────────────────
const BUDGET_LIMIT = () => parseFloat(process.env.BUDGET_LIMIT_USD || '100');
const BUDGET_PATHS = ['/gemini', '/nvidia', '/opencode', '/z-ai'];
const SKIP_BUDGET  = ['/models', '/generate-title'];

async function callBudgetRpc(rpcName, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) return null;
  const r = await fetch(`${url}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.ok ? r.json() : null;
}

async function checkBudget(userId) {
  return callBudgetRpc('check_budget', { p_user_id: userId, p_limit_usd: BUDGET_LIMIT() });
}

// ─── GET /budget — on-demand usage fetch ──────────────────────────────────────
async function handleGetBudget(req, res, userId) {
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const budget = await checkBudget(userId);
  if (!budget) return res.status(503).json({ error: 'Budget service unavailable' });
  res.json({
    cost_usd:  budget.cost_usd,
    limit_usd: budget.limit_usd,
    remaining: budget.remaining,
    period:    budget.period,
    allowed:   budget.allowed
  });
}

function recordUsage(userId, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return;
  callBudgetRpc('record_usage', { p_user_id: userId, p_input_tokens: inputTokens || 0, p_output_tokens: outputTokens || 0 })
    .catch(e => console.error('[budget] record_usage failed:', e.message));
}

// Wraps proxyRequestWithRotation to intercept usage chunks from SSE stream
async function proxyWithBudget(req, res, targetUrl, envName, isBearer, userId) {
  const keyInfo = getApiKey(envName, false);
  if (!keyInfo) return res.status(500).json({ error: `Server Configuration Error: ${envName} is missing.` });
  const headers = new Headers();
  if (isBearer) headers.set('Authorization', `Bearer ${keyInfo.value}`);
  else headers.set('x-goog-api-key', keyInfo.value);
  const forwardHeaders = ['content-type', 'accept', 'user-agent'];
  for (const h of forwardHeaders) { const val = req.headers[h]; if (val) headers.set(h, val); }
  const body = (req.method === 'POST' || req.method === 'PUT')
    ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
  try {
    const upstreamRes = await fetch(targetUrl, { method: req.method, headers, body });
    if (upstreamRes.status === 429 && keyInfo.pool.keys.length > 1) {
      getApiKey(envName, true);
      return proxyWithBudget(req, res, targetUrl, envName, isBearer, userId);
    }
    res.status(upstreamRes.status);
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (k !== 'transfer-encoding' && k !== 'content-encoding') res.setHeader(k, v);
    }
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    if (!upstreamRes.body) return res.end();
    // Intercept stream to catch usage chunk
    let inputTok = 0, outputTok = 0;
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const flush = () => {
      // Parse SSE lines looking for usage: {"usage":{"prompt_tokens":N,"completion_tokens":M}}
      for (const line of buf.split('\n')) {
        const trim = line.replace(/^data:\s*/, '');
        if (!trim || trim === '[DONE]') continue;
        try {
          const j = JSON.parse(trim);
          const u = j.usage || j.usageMetadata;
          if (u) {
            inputTok  += u.prompt_tokens     || u.promptTokenCount     || u.input_tokens  || 0;
            outputTok += u.completion_tokens || u.candidatesTokenCount || u.output_tokens || 0;
          }
        } catch {}
      }
      buf = '';
    };
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buf += chunk;
          res.write(chunk);
        }
        flush();
        recordUsage(userId, inputTok, outputTok);
      } catch {}
      res.end();
    })();
  } catch (err) {
    console.error(`Upstream proxy error: ${targetUrl}`, err);
    res.status(502).json({ error: `Upstream Proxy Error: ${err.message}` });
  }
}


// [envPrefix, defaultId, name, multimodal, contextWindow, badge, provider, reasoningEffort]
// provider: 'gemini' | 'nvidia' | 'opencode' | 'z-ai'
// reasoningEffort: injected by proxy before forwarding. null = send nothing (model always thinks).
// Verified by live curl tests against each provider's actual API.
const MODEL_DEFINITIONS = [
  ['GEMINI_FLASH_LITE', 'gemini-3.1-flash-lite',          'Gemini 3.1 Flash Lite', true,  1000000, 'Fast',      'gemini',   'high'],   // tested: high works, max → 400; not a thinking model so no visible effect
  ['GEMMA',            'gemma-4-26b-a4b-it',              'Gemma 4 26B',           true,  256000,  'Unlimited', 'gemini',   'high'],   // tested: only high works (max/low/none → 400); thinks via <thought> tags, frontend strips them
  ['KIMI',             'nvidia/moonshotai/kimi-k2.6',     'Kimi K2.6',             true,  256000,  'Fast',      'nvidia',   'max'],   // tested: accepts all values
  ['NEMOTRON_3_ULTRA', 'opencode/nemotron-3-ultra-free',  'Nemotron Ultra',        false, 256000,  'Slow',      'opencode', 'xhigh'], // tested: 'max' → 400
  ['DEEPSEEK_FLASH',   'opencode/deepseek-v4-flash-free', 'DeepSeek V4 Flash',     false, 1000000, 'Fast',      'opencode', 'max'],
  ['BIG_PICKLE',       'opencode/big-pickle',             'Big Pickle',            false, 200000,  'Max',       'opencode', 'max'],
  ['MIMO_FREE',        'opencode/mimo-v2.5-free',         'MiMo V2.5',             true,  1000000, 'Long',      'opencode', 'xhigh'], // tested: 'max' → 400
  ['GLM_4_5_FLASH',    'zai/GLM-4.5-Flash',               'GLM 4.5 Flash',         false, 128000,  'Max',       'z-ai',     'max'],   // tested: accepts max, reasoning_content separate field
];

// Provider → availability key mapping
const PROVIDER_KEY = { gemini: 'GOOGLE_GENERATIVE_AI_API_KEY', nvidia: 'NVIDIA_API_KEY', opencode: 'OPENCODE_API_KEY', 'z-ai': 'Z_AI_API_KEY' };

async function handleModels(req, res) {
  const models = {};
  for (const [prefix, defaultId, defaultName, defaultMultimodal, defaultContextWindow, defaultBadge, defaultProvider, defaultReasoningEffort] of MODEL_DEFINITIONS) {
    const id       = process.env[`${prefix}_MODEL_ID`] || defaultId;
    const provider = process.env[`${prefix}_PROVIDER`] || defaultProvider;
    const envKey   = PROVIDER_KEY[provider];
    if (envKey && !process.env[envKey]) continue; // skip if provider key not configured
    const name            = process.env[`${prefix}_MODEL_NAME`]       || defaultName;
    const multimodal      = process.env[`${prefix}_MULTIMODAL`]       ? process.env[`${prefix}_MULTIMODAL`] === 'true' : defaultMultimodal;
    const contextWindow   = process.env[`${prefix}_CONTEXT_WINDOW`]   ? parseInt(process.env[`${prefix}_CONTEXT_WINDOW`], 10) : defaultContextWindow;
    const badge           = process.env[`${prefix}_BADGE`]            || defaultBadge || null;
    const reasoningEffort = process.env[`${prefix}_REASONING_EFFORT`] !== undefined ? (process.env[`${prefix}_REASONING_EFFORT`] || null) : defaultReasoningEffort;
    models[prefix.toLowerCase()] = { id, name, multimodal, contextWindow, badge, provider, reasoningEffort };
  }
  res.json(models);
}

// Build a lookup: modelId → reasoningEffort, for use in the proxy injection middleware.
// Called once per request — models object is rebuilt each time (TTL handled client-side).
function getModelMeta() {
  const meta = {};
  for (const [prefix, defaultId, , , , , defaultProvider, defaultReasoningEffort] of MODEL_DEFINITIONS) {
    const id              = process.env[`${prefix}_MODEL_ID`] || defaultId;
    const provider        = process.env[`${prefix}_PROVIDER`] || defaultProvider;
    const reasoningEffort = process.env[`${prefix}_REASONING_EFFORT`] !== undefined ? (process.env[`${prefix}_REASONING_EFFORT`] || null) : defaultReasoningEffort;
    meta[id] = { provider, reasoningEffort };
  }
  return meta;
}

// ─── Gemini handler ───────────────────────────────────────────────────────────
async function handleGemini(req, res, userId) {
  const subpath = req.normalizedPath.replace(/^\/gemini/, '');
  const allowedPatterns = [
    /^\/v1beta\/models$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]generateContent$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]streamGenerateContent$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]countTokens$/,
    /^\/v1beta\/openai\/chat\/completions$/,
    /^\/v1beta\/openai\/models$/
  ];
  if (!allowedPatterns.some(p => p.test(subpath)))
    return res.status(403).json({ error: `Path not allowed: ${subpath}` });
  const urlObj = new URL(req.url, 'http://localhost');
  const targetUrl = `https://generativelanguage.googleapis.com${subpath}${urlObj.search}`;
  const isOai = subpath.startsWith('/v1beta/openai');
  return userId
    ? proxyWithBudget(req, res, targetUrl, 'GOOGLE_GENERATIVE_AI_API_KEY', isOai, userId)
    : proxyRequestWithRotation(req, res, targetUrl, 'GOOGLE_GENERATIVE_AI_API_KEY', isOai);
}

// ─── reasoning_effort injection — server injects before forwarding ───────────
// Intercepts POST /chat/completions body, adds reasoning_effort if model metadata defines it.
// This keeps ALL provider-specific knowledge server-side; clients send vanilla OpenAI payloads.
function injectReasoningEffort(req, modelMeta) {
  if (req.method !== 'POST') return;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') return;
    const modelId = body.model;
    if (!modelId) return;
    const meta = modelMeta[modelId];
    if (!meta?.reasoningEffort) return;
    if (!body.reasoning_effort) body.reasoning_effort = meta.reasoningEffort;
    req.body = JSON.stringify(body);
    req.headers['content-length'] = Buffer.byteLength(req.body).toString();
  } catch { /* malformed body — pass through unchanged */ }
}

// ─── OpenAI-compat handler (nvidia / opencode / z-ai) ───────────────────────
const OPENAI_COMPAT_PATHS = [/^\/v1\/models$/, /^\/v1\/chat\/completions$/];
async function handleOpenAICompat(req, res, config, userId) {
  const subpath = req.normalizedPath.replace(new RegExp(`^\\/${config.functionName}`), '');
  if (!OPENAI_COMPAT_PATHS.some(p => p.test(subpath)))
    return res.status(403).json({ error: `Path not allowed: ${subpath}` });
  // subpathTransform: optional fn to rewrite the path before appending to baseUrl.
  // Used for z-ai whose upstream is /api/paas/v4/... not /v1/...
  const targetPath = config.subpathTransform ? config.subpathTransform(subpath) : subpath;
  const urlObj = new URL(req.url, 'http://localhost');
  const targetUrl = `${config.baseUrl}${targetPath}${urlObj.search}`;
  injectReasoningEffort(req, config.modelMeta);
  return userId
    ? proxyWithBudget(req, res, targetUrl, config.envKey, true, userId)
    : proxyRequestWithRotation(req, res, targetUrl, config.envKey, true);
}

// ─── Tavily search ────────────────────────────────────────────────────────────
const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_LIMIT = 10;
const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

async function handleTavily(req, res) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'Server Configuration Error: TAVILY_API_KEY is missing.' });
  const { query, domain, maxResults, searchDepth, topic, includeImages } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length === 0)
    return res.status(400).json({ error: "'query' is required and must be a non-empty string." });
  if (query.length > MAX_QUERY_LENGTH)
    return res.status(400).json({ error: `'query' must not exceed ${MAX_QUERY_LENGTH} characters.` });
  if (domain !== undefined && domain !== null) {
    if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain))
      return res.status(400).json({ error: "'domain' must be a valid domain name (e.g. example.com)." });
  }
  const resolvedMaxResults = Math.min(Math.max(1, Number.isInteger(maxResults) ? maxResults : 5), MAX_RESULTS_LIMIT);
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey, query: query.trim(),
        include_domains: domain ? [domain] : undefined,
        include_answer: true, max_results: resolvedMaxResults,
        search_depth: searchDepth || 'basic',
        topic: topic || 'general', include_images: !!includeImages
      })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─── Title generator ──────────────────────────────────────────────────────────
async function handleGenerateTitle(req, res, attempt = 1) {
  const { text } = req.body;
  if (!text || !text.trim()) return res.json({ title: 'New Conversation' });
  const keyInfo = getApiKey('NVIDIA_API_KEY', attempt > 1);
  if (!keyInfo) return res.status(500).json({ error: 'Server Configuration Error: NVIDIA_API_KEY is missing.' });
  const payload = {
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: `Generate a short 3-6 word title for this conversation. No quotes, no punctuation at end. Just the title.\n\n${text.slice(0, 3000)}` }],
    temperature: 0.2, top_p: 0.7, max_tokens: 1024, stream: false
  };
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyInfo.value}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.status === 429 && attempt < keyInfo.pool.keys.length) return handleGenerateTitle(req, res, attempt + 1);
    if (!response.ok) return res.json({ title: 'New Conversation' });
    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || 'New Conversation';
    title = title.replace(/^\"|\"$/g, '').replace(/\.$/, '');
    res.json({ title });
  } catch (err) { res.json({ title: 'New Conversation' }); }
}

// ─── Image generator ──────────────────────────────────────────────────────────
// Uses NVIDIA FLUX.2-klein-4b NIM. Response shape: { artifacts: [{ base64, finish_reason }] }
// The mobile GenerateImageTool also handles { data: [{ b64_json }] } as a fallback.
async function handleGenerateImage(req, res) {
  // FIX: use getApiKeyVal() — getApiKey() returns { value, pool } not a string
  const activeApiKey = getApiKeyVal('NVIDIA_API_KEY');
  if (!activeApiKey) return res.status(500).json({ error: 'Server Configuration Error: NVIDIA_API_KEY is missing.' });
  const { prompt, width = 1024, height = 1024, steps = 4, seed = 0 } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim())
    return res.status(400).json({ error: 'Missing or invalid prompt parameter' });
  // Snap dimensions to nearest multiple of 16, clamped to 512–1568
  const snap = v => Math.min(Math.max(Math.round(Number(v) / 16) * 16, 512), 1568);
  const payload = {
    prompt: prompt.trim(),
    width: snap(width), height: snap(height),
    steps: Math.min(Math.max(Number(steps), 1), 50),
    seed: Number(seed)
  };
  try {
    const response = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `NVIDIA invocation failed (${response.status}): ${errText}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message || 'Error communicating with NVIDIA FLUX API' }); }
}

// ─── E2B Sandbox proxy ────────────────────────────────────────────────────────
// Shared by OrchCode desktop and OrchApp mobile — both route E2B calls here.
async function handleE2BSandboxCreate(req, res) {
  const e2bApiKey = process.env.E2B_API_KEY;
  const e2bTemplateId = process.env.E2B_TEMPLATE_ID;
  if (!e2bApiKey || !e2bTemplateId)
    return res.status(500).json({ error: 'E2B configuration missing: E2B_API_KEY or E2B_TEMPLATE_ID not set.' });
  const payload = {
    templateID: e2bTemplateId,
    timeout: 1200, // 20 min — E2B maximum
    metadata: req.body?.metadata ?? { source: 'orch' }
  };
  try {
    const response = await fetch('https://api.e2b.app/sandboxes', {
      method: 'POST',
      headers: { 'X-API-Key': e2bApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const rawText = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json')
      || rawText.trimStart().startsWith('{') || rawText.trimStart().startsWith('[');
    const safeBody = isJson ? rawText : JSON.stringify({ error: `E2B HTTP ${response.status}: ${rawText.slice(0, 200)}` });
    res.status(response.status).set('Content-Type', 'application/json').send(safeBody);
  } catch (err) { res.status(502).json({ error: err.message }); }
}

async function handleE2BSandboxKill(req, res) {
  const e2bApiKey = process.env.E2B_API_KEY;
  if (!e2bApiKey) return res.status(500).json({ error: 'E2B_API_KEY missing.' });
  const sandboxId = req.params.sandboxId;
  if (!sandboxId) return res.status(400).json({ error: 'sandboxId is required.' });
  try {
    const response = await fetch(`https://api.e2b.app/sandboxes/${sandboxId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': e2bApiKey }
    });
    if (response.status === 204) return res.status(204).end();
    const data = await response.text();
    res.status(response.status).set('Content-Type', 'application/json').send(data || '{}');
  } catch (err) { res.status(502).json({ error: err.message }); }
}

// ─── Router ───────────────────────────────────────────────────────────
app.all('*', async (req, res) => {
  const path = req.normalizedPath;
  const userId = req.user?.id;

  // Budget gate — runs before all metered LLM endpoints
  if (userId && BUDGET_PATHS.some(p => path.startsWith(p))) {
    const budget = await checkBudget(userId);
    if (budget) {
      res.setHeader('X-Budget-Remaining', budget.remaining);
      res.setHeader('X-Budget-Used',      budget.cost_usd);
      res.setHeader('X-Budget-Limit',     budget.limit_usd);
      res.setHeader('X-Budget-Period',    budget.period);
      if (!budget.allowed) {
        return res.status(429).json({
          error: `Monthly budget of $${budget.limit_usd} reached. Used: $${budget.cost_usd}. Resets ${budget.period}-01.`,
          code: 'BUDGET_EXCEEDED', cost_usd: budget.cost_usd, limit_usd: budget.limit_usd, period: budget.period
        });
      }
    }
  }

  const modelMeta = getModelMeta();
  if (req.method === 'GET'    && path === '/models')                  return handleModels(req, res);
  if (req.method === 'GET'    && path === '/budget')                  return handleGetBudget(req, res, userId);
  if (path.startsWith('/gemini'))   { injectReasoningEffort(req, modelMeta); return handleGemini(req, res, userId); }
  if (path.startsWith('/nvidia'))   return handleOpenAICompat(req, res, { functionName: 'nvidia',   envKey: 'NVIDIA_API_KEY',   baseUrl: 'https://integrate.api.nvidia.com',       modelMeta }, userId);
  if (path.startsWith('/opencode')) return handleOpenAICompat(req, res, { functionName: 'opencode', envKey: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai/zen',                modelMeta }, userId);
  if (path.startsWith('/z-ai'))     return handleOpenAICompat(req, res, { functionName: 'z-ai',     envKey: 'Z_AI_API_KEY',     baseUrl: 'https://open.bigmodel.cn/api/paas/v4',   modelMeta, subpathTransform: s => s.replace('/v1', '') }, userId);
  if (req.method === 'POST'   && path === '/tavily')                  return handleTavily(req, res);
  if (req.method === 'POST'   && path === '/generate-title')          return handleGenerateTitle(req, res);
  if (req.method === 'POST'   && path === '/generate-image')          return handleGenerateImage(req, res);
  if (req.method === 'POST'   && path === '/e2b/sandboxes')           return handleE2BSandboxCreate(req, res);
  if (req.method === 'DELETE' && path.startsWith('/e2b/sandboxes/')) {
    req.params = { sandboxId: path.replace('/e2b/sandboxes/', '') };
    return handleE2BSandboxKill(req, res);
  }

  res.status(404).json({ error: `Not Found: ${req.path}` });
});

functions.http('api', app);
