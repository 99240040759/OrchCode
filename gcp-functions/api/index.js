require('dotenv').config();
const { Readable } = require('stream');
const { Agent } = require('undici');
const functions = require('@google-cloud/functions-framework');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { tavily } = require('@tavily/core');
const { Groq } = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');
const { GoogleAuth } = require('google-auth-library');
const { handleComposio } = require('./composio');

const vertexAgent = new Agent({ headersTimeout: 360_000, bodyTimeout: 0, connectTimeout: 20_000 });

const app = express();
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '20mb' }));

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

const tv = tavily({ apiKey: process.env.TAVILY_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'orchllc';
const VERTEX_REGION = process.env.VERTEX_REGION || 'global';

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const vertexAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

let _vertexTokenCache = null;
async function getVertexToken() {
  const now = Date.now();
  if (_vertexTokenCache && _vertexTokenCache.expiresAt > now) {
    return _vertexTokenCache.token;
  }
  const client = await vertexAuth.getClient();
  const token = await client.getAccessToken();
  _vertexTokenCache = { token: token.token, expiresAt: now + 55 * 60 * 1000 };
  return token.token;
}

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  let cleanPath = req.path.replace(/^\/functions\/v1\/api/, '').replace(/^\/api/, '');
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
  req.normalizedPath = cleanPath;
  if (cleanPath.endsWith('/models')) return next();
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.substring(7));
    req.user = { id: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    console.error('[Auth] token verification failed:', err?.code, err?.message);
    res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN' });
  }
});

const BUDGET_LIMIT = Number(process.env.BUDGET_LIMIT_USD || 20);
const BUDGET_PATHS = ['/vertex', '/gemini'];
const _budgetCache = new Map();
const BUDGET_CACHE_TTL_MS = 30000;

async function checkBudget(userId) {
  const now = Date.now();
  const cached = _budgetCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.data;
  const doc = await firestore.collection('budget').doc(userId).get();
  const period = new Date().toISOString().slice(0, 7);
  let data;
  if (!doc.exists || doc.data().period !== period) {
    await firestore.collection('budget').doc(userId).set(
      { costUsd: 0, limitUsd: BUDGET_LIMIT, remaining: BUDGET_LIMIT, period },
      { merge: true }
    );
    data = { cost_usd: 0, limit_usd: BUDGET_LIMIT, remaining: BUDGET_LIMIT, period, allowed: true };
  } else {
    const d = doc.data();
    const limit = d.limitUsd ?? BUDGET_LIMIT;
    const cost = d.costUsd ?? 0;
    const remaining = d.remaining ?? limit - cost;
    data = { cost_usd: cost, limit_usd: limit, remaining, period: d.period, allowed: remaining > 0 };
  }
  _budgetCache.set(userId, { data, expiresAt: now + BUDGET_CACHE_TTL_MS });
  return data;
}

function invalidateBudgetCache(userId) { _budgetCache.delete(userId); }

async function handleGetBudget(req, res, userId) {
  const budget = await checkBudget(userId);
  res.json({ cost_usd: budget.cost_usd, limit_usd: budget.limit_usd, remaining: budget.remaining, period: budget.period, allowed: budget.allowed });
}

const SUMMARY_MODEL = 'gemini-3.5-flash-lite';

const PRICING_PER_MILLION = {
  'gemini-3.5-flash-lite': { input: 4, output: 10 },
  'gemini-3.7-flash': { input: 5, output: 15 },
};

function normalizeUsage(u) {
  const input = u.promptTokenCount + (u.toolUsePromptTokenCount || 0);
  return {
    input,
    output: u.totalTokenCount - input,
  };
}

function usageCostUsd(model, { input, output }) {
  const pricing = PRICING_PER_MILLION[model];
  return (input * pricing.input + output * pricing.output) / 1e6;
}

async function recordUsage(userId, model, usage) {
  if (!usage.input && !usage.output) return;
  invalidateBudgetCache(userId);
  const cost = usageCostUsd(model, usage);
  await firestore.collection('budget').doc(userId).set(
    {
      costUsd: admin.firestore.FieldValue.increment(cost),
      remaining: admin.firestore.FieldValue.increment(-cost),
      period: new Date().toISOString().slice(0, 7),
    },
    { merge: true }
  );
}

const MODELS_RESPONSE = {
  gemini_3_5_flash_lite: {
    id: 'gemini-3.5-flash-lite',
    name: 'Lite',
    provider: 'vertex',
    contextWindow: 1000000,
    maxTokens: 65536,
    capabilities: ['tools', 'streaming', 'thinking', 'images'],
    badge: 'Value'
  },
  gemini_3_7_flash: {
    id: 'gemini-3.7-flash',
    name: 'Swift',
    provider: 'vertex',
    contextWindow: 1000000,
    maxTokens: 65536,
    capabilities: ['tools', 'streaming', 'thinking', 'images'],
    badge: 'Value'
  }
};

function handleModels(req, res) {
  res.json(MODELS_RESPONSE);
}

async function handleGeminiVertex(req, res, userId) {
  const sub = req.normalizedPath.replace(/^\/(gemini|vertex)/, '');
  const match = sub.match(/models\/([^:/]+):([A-Za-z]+)/);
  if (!match) {
    return res.status(400).json({ error: 'Expected models/{model}:{method}', code: 'BAD_REQUEST' });
  }
  const [, model, verb] = match;
  if (!Object.values(MODELS_RESPONSE).some((entry) => entry.id === model)) {
    return res.status(400).json({ error: `Unsupported model: ${model}`, code: 'BAD_REQUEST' });
  }
  if (verb !== 'generateContent' && verb !== 'streamGenerateContent') {
    return res.status(400).json({ error: `Unsupported method: ${verb}`, code: 'BAD_REQUEST' });
  }
  const isStreaming = verb === 'streamGenerateContent';

  const query = new URLSearchParams(req.url.split('?')[1] || '');
  query.delete('key');
  if (isStreaming) query.set('alt', 'sse');
  const queryString = query.toString() ? `?${query}` : '';

  const targetUrl = `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_REGION}/publishers/google/models/${model}:${verb}${queryString}`;

  try {
    const vertexToken = await getVertexToken();
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': isStreaming ? 'text/event-stream' : 'application/json',
        'Authorization': `Bearer ${vertexToken}`,
      },
      body: JSON.stringify(req.body ?? {}),
      dispatcher: vertexAgent,
    });

    res.status(upstreamRes.status);
    const skip = new Set(['transfer-encoding', 'content-encoding', 'connection', 'content-length', 'cache-control', 'content-type']);
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (!skip.has(k)) res.setHeader(k, v);
    }
    if (isStreaming && upstreamRes.ok) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    } else {
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
    }
    req.socket?.setNoDelay(true);
    if (!upstreamRes.body) return res.end();
    res.flushHeaders();

    let usageMetadata = null;
    const decoder = new TextDecoder();
    let pending = '';
    const observe = (text) => {
      try {
        const u = JSON.parse(text)?.usageMetadata;
        if (u) usageMetadata = u;
      } catch { }
    };
    const observeSseLine = (line) => {
      if (line.startsWith('data:')) observe(line.slice(5).trim());
    };

    try {
      for await (const chunk of Readable.fromWeb(upstreamRes.body)) {
        if (upstreamRes.ok) {
          pending += decoder.decode(chunk, { stream: true });
          if (isStreaming) {
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            lines.forEach(observeSseLine);
          }
        }
        const ok = res.write(chunk);
        if (typeof res.flush === 'function') res.flush();
        if (!ok) await new Promise((resolve) => res.once('drain', resolve));
      }
      if (upstreamRes.ok) {
        pending += decoder.decode();
        if (isStreaming) observeSseLine(pending.trim());
        else observe(pending);
      }
    } catch (streamErr) {
      if (streamErr.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[Vertex] stream error:', streamErr.message);
      }
    } finally {
      res.end();
      if (usageMetadata) {
        const usage = normalizeUsage(usageMetadata);
        const cost = usageCostUsd(model, usage);
        console.log(`[Usage] model=${model} user=${userId} in=${usage.input} out=${usage.output} cost=$${cost.toFixed(6)}`);
        recordUsage(userId, model, usage).catch((err) => console.error('[Usage] record failed', err?.message));
      }
    }
  } catch (err) {
    console.error('[Vertex] proxy error', { targetUrl, code: err?.code, message: err?.message });
    if (!res.headersSent) {
      const safe = classifyError(err);
      res.status(safe.status).json({ error: safe.error, code: safe.code });
    } else {
      res.end();
    }
  }
}

async function handleTavily(req, res) {
  const { query, domain, topic, maxResults, searchDepth, includeImages } = req.body;
  const data = await tv.search(query.trim(), {
    searchDepth: searchDepth || 'basic',
    topic: topic || 'general',
    maxResults: maxResults || 5,
    includeImages: Boolean(includeImages),
    includeDomains: domain ? [domain] : undefined
  });
  res.json(data);
}

async function handleTranscribe(req, res) {
  const file = await Groq.toFile(Buffer.from(req.body.audio, 'base64'), 'audio.webm', { type: 'audio/webm' });
  const transcription = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3'
  });
  res.json({ text: transcription.text || '' });
}

async function handleTitle(req, res) {
  const response = await genAI.models.generateContent({
    model: SUMMARY_MODEL,
    contents: `Generate a concise, 3 to 6 word title summarizing this user prompt. Do not use quotes or punctuation.\n\nUser prompt: ${req.body.prompt}`
  });
  const title = (response.text || '').trim().replace(/^["']|["']$/g, '');
  res.json({ title });
}

async function handleSummarize(req, res) {
  const { system, prompt, maxTokens } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const response = await genAI.models.generateContent({
    model: SUMMARY_MODEL,
    contents: prompt,
    config: {
      systemInstruction: typeof system === 'string' && system.trim() ? system : undefined,
      maxOutputTokens: Math.min(Math.max(Number(maxTokens) || 8000, 512), 16000),
      temperature: 0.2,
    },
  });
  res.json({ text: (response.text || '').trim() });
}

app.all('*', async (req, res, next) => {
  try {
    const path = req.normalizedPath;
    const userId = req.user?.id;
    console.log(`[Request] path: ${path}, userId: ${userId}`);

    if (userId && BUDGET_PATHS.some(p => path.startsWith(p))) {
      const budget = await checkBudget(userId);
      if (budget) {
        res.setHeader('X-Budget-Remaining', budget.remaining);
        res.setHeader('X-Budget-Used', budget.cost_usd);
        res.setHeader('X-Budget-Limit', budget.limit_usd);
        res.setHeader('X-Budget-Period', budget.period);
        if (!budget.allowed) {
          return res.status(429).json({
            error: `Monthly budget of $${budget.limit_usd} reached. Used: $${budget.cost_usd}. Resets ${budget.period}-01.`,
            code: 'BUDGET_EXCEEDED', cost_usd: budget.cost_usd, limit_usd: budget.limit_usd, period: budget.period
          });
        }
      }
    }

    if (req.method === 'GET' && path === '/models') return handleModels(req, res);
    if (req.method === 'GET' && path === '/budget') return handleGetBudget(req, res, userId);
    if (path.startsWith('/gemini') || path.startsWith('/vertex')) return handleGeminiVertex(req, res, userId);
    if (req.method === 'POST' && path === '/tavily') return handleTavily(req, res);
    if (req.method === 'POST' && path === '/transcribe') return handleTranscribe(req, res);
    if (req.method === 'POST' && path === '/title') return await handleTitle(req, res);
    if (req.method === 'POST' && path === '/summarize') return await handleSummarize(req, res);
    if (path.startsWith('/composio/')) return await handleComposio(req, res, userId);
    res.status(404).json({ error: `Not Found: ${req.path}` });
  } catch (err) {
    next(err);
  }
});

function classifyError(err) {
  const upstream = Number(err?.status || err?.statusCode || err?.response?.status) || 0;

  const netCodes = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  ]);
  const code = typeof err?.code === 'string' ? err.code : '';

  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return { status: 503, code: 'STORE_UNAVAILABLE', error: 'Service temporarily unavailable. Please retry.' };
  }
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return { status: 500, code: 'INTERNAL', error: 'Internal service error.' };
  }

  if (netCodes.has(code)) {
    return { status: 504, code: 'UPSTREAM_TIMEOUT', error: 'The model provider did not respond in time. Please retry.' };
  }

  if (upstream === 401 || upstream === 403) {
    return { status: 502, code: 'UPSTREAM_AUTH', error: 'The model provider rejected the request.' };
  }
  if (upstream === 429) {
    return { status: 429, code: 'UPSTREAM_RATE_LIMIT', error: 'The model provider is rate limiting requests. Please retry shortly.' };
  }
  if (upstream === 400 || upstream === 422) {
    return { status: 400, code: 'BAD_REQUEST', error: 'The request was rejected by the model provider.' };
  }
  if (upstream >= 500 && upstream <= 599) {
    return { status: 502, code: 'UPSTREAM_ERROR', error: 'The model provider returned an error. Please retry.' };
  }

  return { status: 500, code: 'INTERNAL', error: 'Internal service error.' };
}

app.use((err, req, res, next) => {
  console.error('[Global Error]', {
    path: req?.normalizedPath,
    userId: req?.user?.id,
    message: err?.message,
    code: err?.code,
    status: err?.status || err?.statusCode,
    stack: err?.stack,
  });
  if (res.headersSent) return next(err);
  const safe = classifyError(err);
  res.status(safe.status).json({ error: safe.error, code: safe.code });
});

functions.http('api', app);
