require('dotenv').config();
const functions = require('@google-cloud/functions-framework');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();

app.use(cors({ origin: 'app://orch-code' }));
app.use(express.json());
app.use(express.text({ type: '*/*' }));

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Auth validation middleware
app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const expectedAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!expectedAnonKey || !supabaseUrl) {
    return res.status(500).json({ error: 'Server Configuration Error: Missing Supabase credentials.' });
  }

  const apiKeyHeader = req.headers['apikey'];
  const authHeader = req.headers['authorization'];
  let clientKey = '';
  if (apiKeyHeader) {
    clientKey = apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    clientKey = authHeader.substring(7);
  }

  if (!clientKey || !timingSafeEqual(clientKey.trim(), expectedAnonKey.trim())) {
    return res.status(401).json({ error: 'Unauthorized API Client' });
  }

  // Normalize path by stripping '/functions/v1/api' or '/api' prefix
  let cleanPath = req.path.replace(/^\/functions\/v1\/api/, '').replace(/^\/api/, '');
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
  req.normalizedPath = cleanPath;

  const isPublic = cleanPath.endsWith('/models');
  if (isPublic) {
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized User: Missing JWT' });
  }

  try {
    const supabase = createClient(supabaseUrl, expectedAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized User: Invalid JWT' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized User: Invalid JWT' });
  }
});

// Proxy helper
async function proxyRequest(req, res, targetUrl, authHeaders) {
  const headers = new Headers(authHeaders);
  const forwardHeaders = ['content-type', 'accept', 'user-agent', 'origin', 'referer'];
  for (const h of forwardHeaders) {
    const val = req.headers[h];
    if (val) headers.set(h, val);
  }

  let body = undefined;
  if (req.method === 'POST' || req.method === 'PUT') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined
    });

    res.status(upstreamRes.status);
    
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (k !== 'transfer-encoding' && k !== 'content-encoding') {
        res.setHeader(k, v);
      }
    }
    
    res.setHeader('Access-Control-Allow-Origin', 'app://orch-code');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (upstreamRes.body) {
      Readable.fromWeb(upstreamRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error(`Upstream proxy error: ${targetUrl}`, err);
    res.status(502).json({ error: `Upstream Proxy Error: ${err.message}` });
  }
}

// Model definitions
const MODEL_DEFINITIONS = [
  ['GEMMA',            'gemma-4-26b-a4b-it',            'Gemma 4 26B (Unlimited)'],
  ['KIMI',             'nvidia/moonshotai/kimi-k2.6',     'Kimi K2.6 (Creative)'],
  ['OPENAI_GPT_OSS',   'nvidia/openai/gpt-oss-120b',      'GPT-OSS 120B (Medium)'],
  ['GLM_4_5_FLASH',    'zai/GLM-4.5-Flash',             'GLM 4.5 Flash (Thinking)'],
  ['DEEPSEEK_FLASH',   'opencode/deepseek-v4-flash-free', 'DeepSeek V4 Pro (Thinking)'],
  ['BIG_PICKLE',       'opencode/big-pickle',             'Big Pickle (Unlimited)'],
  ['MIMO_FREE',        'opencode/mimo-v2.5-free',             'MiMo V2.5 (Fast)'],
];

async function handleModels(req, res) {
  const models = {};
  for (const [prefix, defaultId, defaultName] of MODEL_DEFINITIONS) {
    const id = process.env[`${prefix}_MODEL_ID`] || defaultId;
    let isAvailable = true;
    if (id.startsWith('zai/') && !process.env.Z_AI_API_KEY) isAvailable = false;
    if (id.startsWith('opencode/') && !process.env.OPENCODE_API_KEY) isAvailable = false;
    if (id.startsWith('nvidia/') && !process.env.NVIDIA_API_KEY) isAvailable = false;
    if (!id.includes('/') && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) isAvailable = false;

    if (isAvailable) {
      const responseKey = prefix.toLowerCase();
      const name = process.env[`${prefix}_MODEL_NAME`] || defaultName;
      const lid = id.toLowerCase();
      const vision = lid.includes('gemini') || lid.includes('gemma') || lid.includes('kimi') || lid.includes('mimo');
      const nativeFiles = lid.includes('gemini');
      models[responseKey] = { id, name, capabilities: { vision, nativeFiles } };
    }
  }
  res.json(models);
}

// Gemini handler
async function handleGemini(req, res) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.' });
  
  const subpath = req.normalizedPath.replace(/^\/gemini/, '');
  const allowedPatterns = [
    /^\/v1beta\/models$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]generateContent$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]streamGenerateContent$/,
    /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]countTokens$/,
    /^\/v1beta\/openai\/chat\/completions$/,
    /^\/v1beta\/openai\/models$/
  ];
  
  if (!allowedPatterns.some(p => p.test(subpath))) {
    return res.status(403).json({ error: `Path not allowed: ${subpath}` });
  }

  const headers = subpath.startsWith('/v1beta/openai') ? { Authorization: `Bearer ${apiKey}` } : { 'x-goog-api-key': apiKey };
  const urlObj = new URL(req.url, 'http://localhost');
  const targetUrl = `https://generativelanguage.googleapis.com${subpath}${urlObj.search}`;
  
  return proxyRequest(req, res, targetUrl, headers);
}

// OpenAI Compat handlers
const OPENAI_COMPAT_PATHS = [/^\/v1\/models$/, /^\/v1\/chat\/completions$/];

async function handleOpenAICompat(req, res, config) {
  const apiKey = process.env[config.envKey];
  if (!apiKey) {
    return res.status(500).json({ error: `Server Configuration Error: ${config.envKey} is missing.` });
  }
  
  const subpath = req.normalizedPath.replace(new RegExp(`^\/${config.functionName}`), '');
  if (!OPENAI_COMPAT_PATHS.some(p => p.test(subpath))) {
    return res.status(403).json({ error: `Path not allowed: ${subpath}` });
  }

  const targetPath = config.pathReplace ? subpath.replace(config.pathReplace.search, config.pathReplace.replace) : subpath;
  const urlObj = new URL(req.url, 'http://localhost');
  const targetUrl = `${config.baseUrl}${targetPath}${urlObj.search}`;

  return proxyRequest(req, res, targetUrl, { Authorization: `Bearer ${apiKey}` });
}

// Tavily handler
const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_LIMIT = 10;
const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

async function handleTavily(req, res) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'Server Configuration Error: TAVILY_API_KEY is missing.' });
  
  const body = req.body;
  const { query, domain, maxResults, searchDepth, topic, includeImages } = body;
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: "'query' is required and must be a non-empty string." });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `'query' must not exceed ${MAX_QUERY_LENGTH} characters.` });
  }
  if (domain !== undefined && domain !== null) {
    if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain)) {
      return res.status(400).json({ error: "'domain' must be a valid domain name (e.g. example.com)." });
    }
  }
  const resolvedMaxResults = Math.min(Math.max(1, Number.isInteger(maxResults) ? maxResults : 5), MAX_RESULTS_LIMIT);
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: query.trim(),
        include_domains: domain ? [domain] : undefined,
        include_answer: true,
        max_results: resolvedMaxResults,
        search_depth: searchDepth || 'basic',
        topic: topic || 'general',
        include_images: !!includeImages
      })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Title generator
async function handleGenerateTitle(req, res) {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.json({ title: 'New Conversation' });
  }
  const activeApiKey = process.env.NVIDIA_API_KEY;
  if (!activeApiKey) return res.status(500).json({ error: 'Server Configuration Error: NVIDIA_API_KEY is missing.' });
  
  const payload = {
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: `Generate a short 3-6 word title for this conversation. No quotes, no punctuation at end. Just the title.\n\n${text.slice(0, 3000)}` }],
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 1024,
    stream: false
  };

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return res.json({ title: 'New Conversation' });
    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || 'New Conversation';
    title = title.replace(/^"|"$/g, '').replace(/\.$/, '');
    res.json({ title });
  } catch (err) {
    res.json({ title: 'New Conversation' });
  }
}

// Image generator
async function handleGenerateImage(req, res) {
  const { prompt, width = 1024, height = 1024, seed = 0, steps = 4 } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing or invalid prompt parameter' });
  }
  const activeApiKey = process.env.NVIDIA_API_KEY;
  if (!activeApiKey) return res.status(500).json({ error: 'Server Configuration Error: NVIDIA_API_KEY is missing.' });
  
  const payload = {
    prompt: prompt.trim(),
    width: Number(width),
    height: Number(height),
    seed: Number(seed),
    steps: Number(steps)
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
      return res.status(502).json({ error: `Nvidia invocation failed with status ${response.status}: ${errText}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error communicating with Nvidia FLUX API' });
  }
}

// Catch-all router
app.all('*', async (req, res) => {
  const path = req.normalizedPath;
  
  if (req.method === 'GET' && path === '/models') {
    return handleModels(req, res);
  }
  if (path.startsWith('/gemini')) {
    return handleGemini(req, res);
  }
  if (path.startsWith('/nvidia')) {
    return handleOpenAICompat(req, res, {
      functionName: 'nvidia',
      envKey: 'NVIDIA_API_KEY',
      baseUrl: 'https://integrate.api.nvidia.com'
    });
  }
  if (path.startsWith('/opencode')) {
    return handleOpenAICompat(req, res, {
      functionName: 'opencode',
      envKey: 'OPENCODE_API_KEY',
      baseUrl: 'https://opencode.ai/zen'
    });
  }
  if (path.startsWith('/z-ai')) {
    return handleOpenAICompat(req, res, {
      functionName: 'z-ai',
      envKey: 'Z_AI_API_KEY',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      pathReplace: { search: /^\/v1/, replace: '' }
    });
  }
  if (req.method === 'POST' && path === '/tavily') {
    return handleTavily(req, res);
  }
  if (req.method === 'POST' && path === '/generate-title') {
    return handleGenerateTitle(req, res);
  }
  if (req.method === 'POST' && path === '/generate-image') {
    return handleGenerateImage(req, res);
  }

  res.status(404).json({ error: `Not Found: ${req.path}` });
});

functions.http('api', app);
