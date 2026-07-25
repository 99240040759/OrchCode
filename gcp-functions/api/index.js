require('dotenv').config();
const functions = require('@google-cloud/functions-framework');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Readable } = require('stream');
const { tavily } = require('@tavily/core');
const { Groq } = require('groq-sdk');
const tar = require('tar');
const { GoogleGenAI } = require('@google/genai');
const mime = require('mime-types');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'orch-user-uploads-693047181061';
const app = express();
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type', 'x-file-mime-type', 'x-file-display-name'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '20mb' }));

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

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
  const idToken = authHeader.substring(7);
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = { id: decoded.uid, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid Firebase ID token' });
  }
});
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
async function proxyUpstream(req, res, targetUrl, envName, isBearer, { userId = null, trackUsage = false } = {}, attempt = 1) {
  const keyInfo = getApiKey(envName, false);
  if (!keyInfo) return res.status(500).json({ error: `Server Configuration Error: ${envName} is missing.` });
  const headers = new Headers({ 'Content-Type': 'application/json', 'Accept': 'application/json' });
  if (isBearer) headers.set('Authorization', `Bearer ${keyInfo.value}`);
  else headers.set('x-goog-api-key', keyInfo.value);
  const body = (req.method === 'POST' || req.method === 'PUT')
    ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
  try {
    const upstreamRes = await fetch(targetUrl, { method: req.method, headers, body });
    if (upstreamRes.status === 429 && keyInfo.pool.keys.length > 1 && attempt < keyInfo.pool.keys.length) {
      getApiKey(envName, true);
      return proxyUpstream(req, res, targetUrl, envName, isBearer, { userId, trackUsage }, attempt + 1);
    }
    res.status(upstreamRes.status);
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (k !== 'transfer-encoding' && k !== 'content-encoding') res.setHeader(k, v);
    }
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    if (!upstreamRes.body) return res.end();
    if (!trackUsage || !userId) {
      Readable.fromWeb(upstreamRes.body).pipe(res);
      return;
    }
    let inputTok = 0, outputTok = 0;
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const trim = line.replace(/^data:\s*/, '').trim();
            if (!trim || trim === '[DONE]') continue;
            try {
              const j = JSON.parse(trim);
              const u = j.usage || j.usageMetadata;
              if (u) {
                const inp = u.prompt_tokens || u.input_tokens || u.total_input_tokens || 0;
                const out = u.completion_tokens || u.output_tokens || u.total_output_tokens || 0;
                if (inp > inputTok) inputTok = inp;
                if (out > outputTok) outputTok = out;
              }
            } catch {}
          }
        }
        if (buf) {
          try {
            const j = JSON.parse(buf.replace(/^data:\s*/, '').trim());
            const u = j.usage || j.usageMetadata;
            if (u) {
              const inp = u.prompt_tokens || u.input_tokens || u.total_input_tokens || 0;
              const out = u.completion_tokens || u.output_tokens || u.total_output_tokens || 0;
              if (inp > inputTok) inputTok = inp;
              if (out > outputTok) outputTok = out;
            }
          } catch {}
        }
      } catch {}
      finally {
        try { recordUsage(userId, inputTok, outputTok); } catch {}
        res.end();
      }
    })();
  } catch (err) {
    console.error(`Upstream proxy error: ${targetUrl}`, err);
    res.status(502).json({ error: `Upstream Proxy Error: ${err.message}` });
  }
}
const BUDGET_LIMIT = () => parseFloat(process.env.BUDGET_LIMIT_USD || '50');
const BUDGET_PATHS = ['/opencode', '/antigravity'];
const _budgetCache = new Map();
const BUDGET_CACHE_TTL_MS = 30000;

async function checkBudget(userId) {
  const now = Date.now();
  const cached = _budgetCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.data;
  try {
    const doc = await firestore.collection('budget').doc(userId).get();
    const period = new Date().toISOString().slice(0, 7);
    let data;
    if (!doc.exists || doc.data().period !== period) {
      const limitUsd = BUDGET_LIMIT();
      await firestore.collection('budget').doc(userId).set(
        { costUsd: 0, limitUsd, remaining: limitUsd, period },
        { merge: true }
      );
      data = { cost_usd: 0, limit_usd: limitUsd, remaining: limitUsd, period, allowed: true };
    } else {
      const d = doc.data();
      data = { cost_usd: d.costUsd, limit_usd: d.limitUsd, remaining: d.remaining, period: d.period, allowed: d.remaining > 0 };
    }
    _budgetCache.set(userId, { data, expiresAt: now + BUDGET_CACHE_TTL_MS });
    return data;
  } catch { return null; }
}

function invalidateBudgetCache(userId) { _budgetCache.delete(userId); }

async function handleGetBudget(req, res, userId) {
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  invalidateBudgetCache(userId);
  const budget = await checkBudget(userId);
  if (!budget) return res.status(503).json({ error: 'Budget service unavailable' });
  res.json({ cost_usd: budget.cost_usd, limit_usd: budget.limit_usd, remaining: budget.remaining, period: budget.period, allowed: budget.allowed });
}

async function recordUsage(userId, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return;
  invalidateBudgetCache(userId);
  const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015);
  try {
    await firestore.collection('budget').doc(userId).set(
      {
        costUsd: admin.firestore.FieldValue.increment(cost),
        remaining: admin.firestore.FieldValue.increment(-cost),
        period: new Date().toISOString().slice(0, 7),
      },
      { merge: true }
    );
  } catch (e) { console.error('[budget] recordUsage failed:', e.message); }
}
const MODEL_DEFINITIONS = [
  { prefix: 'MIMO_FREE', defaultId: 'opencode/mimo-v2.5-free', defaultName: 'Computer', defaultProvider: 'opencode', contextWindow: 1000000, maxTokens: 128000, capabilities: ['tools', 'streaming', 'images', 'reasoning', 'reasoning-effort'], badge: 'Preview', reasoningEffort: 'xhigh', pricing: { input: 5.00, output: 15.00 } },
  { prefix: 'DEEPSEEK_V4_FLASH_FREE', defaultId: 'opencode/deepseek-v4-flash-free', defaultName: 'Orch 1', defaultProvider: 'opencode', contextWindow: 1000000, maxTokens: 384000, capabilities: ['tools', 'streaming', 'reasoning', 'reasoning-effort'], badge: 'Fast', reasoningEffort: 'high', pricing: { input: 5.00, output: 15.00 } }
];
const PROVIDER_KEY = { opencode: 'OPENCODE_API_KEY' };
async function handleModels(req, res) {
  const models = {};
  for (const m of MODEL_DEFINITIONS) {
    const envKey = PROVIDER_KEY[m.defaultProvider];
    if (envKey && !process.env[envKey]) continue;
    models[m.prefix.toLowerCase()] = {
      id: m.defaultId,
      name: m.defaultName,
      provider: m.defaultProvider,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      capabilities: m.capabilities,
      badge: m.badge || null,
      reasoningEffort: m.reasoningEffort || null,
      pricing: m.pricing
    };
  }
  res.json(models);
}
function getModelPricing(modelId) {
  const match = modelId && MODEL_DEFINITIONS.find(m => m.defaultId === modelId || m.defaultId.endsWith('/' + modelId));
  return match ? match.pricing : { input: 0.15, output: 0.60 };
}
const OPENAI_COMPAT_PATHS = [/^\/v1\/models$/, /^\/v1\/chat\/completions$/];
async function handleOpenAICompat(req, res, config, userId) {
  const sub = req.normalizedPath.replace(new RegExp(`^\\/\\${config.functionName}`), '');
  if (!OPENAI_COMPAT_PATHS.some(p => p.test(sub))) return res.status(403).json({ error: `Path not allowed: ${sub}` });
  if (req.body && typeof req.body === 'object' && req.body.model && typeof req.body.model === 'string') {
    req.body.model = req.body.model.replace(/^opencode\//i, '');
  }
  const url = `${config.baseUrl}${sub}${new URL(req.url, 'http://x').search}`;
  return proxyUpstream(req, res, url, config.envKey, true, { userId, trackUsage: !!userId });
}
async function handleTavily(req, res) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'Server Configuration Error: TAVILY_API_KEY is missing.' });
  const { query, domain, topic } = req.body;
  const maxResults = req.body.maxResults ?? req.body.max_results;
  const searchDepth = req.body.searchDepth ?? req.body.search_depth;
  const includeImages = req.body.includeImages ?? req.body.include_images;
  if (!query || typeof query !== 'string' || query.trim().length === 0)
    return res.status(400).json({ error: "'query' is required and must be a non-empty string." });
  try {
    const tv = tavily({ apiKey: tavilyKey });
    const data = await tv.search(query.trim(), {
      searchDepth: searchDepth || 'basic',
      topic: topic || 'general',
      maxResults: Math.min(Math.max(1, Number.isInteger(maxResults) ? maxResults : 5), 10),
      includeImages: !!includeImages,
      includeDomains: domain ? [domain] : undefined
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function handleTranscribe(req, res) {
  const { audio } = req.body;
  if (!audio) return res.status(400).json({ error: 'Missing audio base64 data' });
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return res.status(500).json({ error: 'Server Configuration Error: GROQ_API_KEY is not set' });
  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const file = await Groq.toFile(Buffer.from(audio, 'base64'), 'audio.webm', { type: 'audio/webm' });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3'
    });
    res.json({ text: transcription.text || '' });
  } catch (err) {
    res.status(500).json({ error: `Transcription failed: ${err.message}` });
  }
}

async function handleGenerateImage(req, res) {
  const activeApiKey = getApiKey('NVIDIA_API_KEY')?.value || '';
  if (!activeApiKey) return res.status(500).json({ error: 'Server Configuration Error: NVIDIA_API_KEY is missing.' });
  const { prompt, width = 1024, height = 1024, steps = 4, seed = 0 } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim())
    return res.status(400).json({ error: 'Missing or invalid prompt parameter' });
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
      headers: { 'Authorization': `Bearer ${activeApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `NVIDIA invocation failed (${response.status}): ${errText}` });
    }
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message || 'Error communicating with NVIDIA FLUX API' }); }
}
const ARTIFACT_SENTINEL = /\[SANDBOX_FILE:([^:]+):\s*([^\]]+)\]/g;

async function dbUpsertConversation(userId, convId, title, status, interactionId, environmentId) {
  if (!userId || !convId) return;
  try {
    await firestore
      .collection('users').doc(userId)
      .collection('conversations').doc(convId)
      .set({
        title: title || 'New Chat',
        status,
        interactionId: interactionId || null,
        environmentId: environmentId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
  } catch (e) { console.error('[db] upsert conversation failed:', e.message); }
}

async function dbUpsertMessage(userId, convId, msg) {
  if (!userId || !convId || !msg.id) return;
  try {
    await firestore
      .collection('users').doc(userId)
      .collection('conversations').doc(convId)
      .collection('messages').doc(msg.id)
      .set({
        role: msg.role,
        blocksJson: msg.blocksJson || '[]',
        attachmentsJson: msg.attachmentsJson || '[]',
        toolTracesJson: msg.toolTracesJson || '[]',
        artifactJson: msg.artifactJson || null,
        isStreaming: msg.isStreaming ?? false,
        timestamp: msg.timestamp || Date.now(),
        toolCallId: msg.toolCallId || null,
      }, { merge: true });
  } catch (e) { console.error('[db] upsert message failed:', e.message); }
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID();
}

async function handleAntigravity(req, res, userId, attempt = 1) {
  const keyInfo = getApiKey('GOOGLE_GENERATIVE_AI_API_KEY', false);
  if (!keyInfo) return res.status(500).json({ error: 'Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.' });

  let bodyObj;
  try { bodyObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { bodyObj = req.body; }

  if (bodyObj && typeof bodyObj === 'object') {
    if (bodyObj.interaction_id === '') delete bodyObj.interaction_id;
    if (bodyObj.environment_id === '') delete bodyObj.environment_id;
    if (!bodyObj.environment || bodyObj.environment === 'remote') {
      bodyObj.environment = {
        type: 'remote',
        sources: [{ type: 'gcs', source: `gs://${GCS_BUCKET_NAME}/skills/`, target: '/workspace/.agents/skills' }]
      };
    }
    if (bodyObj.hf_sources && Array.isArray(bodyObj.hf_sources) && bodyObj.hf_sources.length > 0) {
      if (!bodyObj.environment || bodyObj.environment === 'remote') bodyObj.environment = { type: 'remote', sources: [] };
      for (const p of bodyObj.hf_sources) {
        const parentFolder = p.substring(0, p.lastIndexOf('/') + 1);
        bodyObj.environment.sources.push({ type: 'gcs', source: `gs://${GCS_BUCKET_NAME}/${parentFolder}`, target: `/workspace/${parentFolder}` });
      }
    }
    delete bodyObj.hf_sources;
  }

  const convId = (bodyObj && bodyObj.conversation_id) || makeId();
  const userInput = bodyObj && bodyObj.input;
  const userText = typeof userInput === 'string' ? userInput
    : Array.isArray(userInput) ? (userInput.find(p => p.type === 'text')?.text || '') : '';

  if (userId) {
    const title = userText.slice(0, 30) + (userText.length > 30 ? '…' : '');
    if (userText) {
      await dbUpsertMessage(userId, convId, {
        id: bodyObj.user_message_id || makeId(),
        role: 'user',
        blocksJson: JSON.stringify([{ type: 'text', text: userText }]),
        attachmentsJson: JSON.stringify(bodyObj.attachments_meta || []),
        toolTracesJson: '[]',
        isStreaming: false,
        timestamp: Date.now(),
      });
    }
  }

  const asstMsgId = makeId();  const asstMsg = {
    id: asstMsgId,
    role: 'assistant',
    blocksJson: '[]',
    attachmentsJson: '[]',
    toolTracesJson: '[]',
    artifactJson: null,
    isStreaming: true,
    timestamp: Date.now(),
  };

  let textAccum = '';
  let thinkAccum = '';
  let lastFlushAt = Date.now();
  const FLUSH_INTERVAL_MS = 500;
  const FLUSH_CHAR_THRESHOLD = 500;
  const pendingToolTraces = {};
  const pendingArtifacts = [];
  const firedArtifactKeys = new Set();
  let activeEnvironmentId = bodyObj?.environment_id || null;

  async function flushText(force = false) {
    const now = Date.now();
    const shouldFlush = force || textAccum.length >= FLUSH_CHAR_THRESHOLD || (now - lastFlushAt >= FLUSH_INTERVAL_MS && textAccum.length > 0);
    if (!shouldFlush || !userId) return;
    const rawText = textAccum;
    const cleanText = rawText.replace(ARTIFACT_SENTINEL, '').trim();

    for (const match of rawText.matchAll(new RegExp(ARTIFACT_SENTINEL.source, 'g'))) {
      const fileName = match[1];
      const mimeType = match[2].trim();
      const key = `${fileName}:${mimeType}`;
      if (!firedArtifactKeys.has(key)) {
        firedArtifactKeys.add(key);
        pendingArtifacts.push({ fileName, mimeType });
      }
    }

    if (!cleanText && !force) return;
    const block = { type: 'text', text: cleanText };
    const existing = asstMsg.blocks ? asstMsg.blocks.findIndex(b => b.type === 'text') : -1;
    if (!asstMsg.blocks) asstMsg.blocks = [];
    if (existing >= 0) asstMsg.blocks[existing] = block;
    else asstMsg.blocks.push(block);
    if (thinkAccum) {
      const thinkBlock = { type: 'thinking', text: thinkAccum };
      const ti = asstMsg.blocks.findIndex(b => b.type === 'thinking');
      if (ti >= 0) asstMsg.blocks[ti] = thinkBlock;
      else asstMsg.blocks.unshift(thinkBlock);
    }
    asstMsg.toolTracesJson = JSON.stringify(Object.values(pendingToolTraces));
    asstMsg.blocksJson = JSON.stringify(asstMsg.blocks);
    await dbUpsertMessage(userId, convId, { ...asstMsg });
    lastFlushAt = Date.now();
  }

  const forceFlushInterval = setInterval(() => { flushText(true).catch(() => {}); }, 5000);

  let inputTok = 0, outputTok = 0;
  let gotCompleted = false;

  try {
    const ai = new GoogleGenAI({ apiKey: keyInfo.value });
    const responseStream = await ai.interactions.create({ ...bodyObj, stream: true });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    if (res.socket) res.socket.setKeepAlive(true, 30000);

    for await (const chunk of responseStream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      const et = chunk.event_type;

      if (et === 'interaction.created') {
        const iid = chunk.interaction?.id;
        if (iid && userId) {
          const title = userText.slice(0, 30) + (userText.length > 30 ? '…' : '');
          await dbUpsertConversation(userId, convId, title || 'New Chat', 'running', iid, null);
          await dbUpsertMessage(userId, convId, asstMsg);
        }
      }
      else if (et === 'step.start') {
        const step = chunk.step || {};
        if (step.type === 'function_call' || step.type === 'code_execution_call') {
          const traceId = step.id || `step_${Date.now()}`;
          const name = step.type === 'code_execution_call' ? 'run_code' : (step.name || 'tool');
          pendingToolTraces[traceId] = { id: traceId, name, status: 'RUNNING', inputPreview: '', outputPreview: '', startedAt: Date.now(), finishedAt: null };
          asstMsg.toolTracesJson = JSON.stringify(Object.values(pendingToolTraces));
          if (userId) await dbUpsertMessage(userId, convId, { ...asstMsg });
        }
      }

      else if (et === 'step.delta') {
        const delta = chunk.delta || {};
        const dtype = delta.type;

        if (dtype === 'thought_summary') {
          const text = delta.content?.text || '';
          if (text) thinkAccum += text;
        }
        else if (dtype === 'code_execution_call') {
          const code = delta.arguments?.code || '';
          const traceId = Object.keys(pendingToolTraces).find(k => pendingToolTraces[k].name === 'run_code' && pendingToolTraces[k].status === 'RUNNING') || `code_${Date.now()}`;
          if (pendingToolTraces[traceId]) {
            pendingToolTraces[traceId].inputPreview = code.trim().split('\n')[0].slice(0, 80);
          }
        }
        else if (dtype === 'code_execution_result') {
          const result = delta.result || '';
          const isErr = result.toLowerCase().includes('error') || result.toLowerCase().includes('traceback');
          const traceId = Object.keys(pendingToolTraces).find(k => pendingToolTraces[k].name === 'run_code' && pendingToolTraces[k].status === 'RUNNING');
          if (traceId) {
            pendingToolTraces[traceId].status = isErr ? 'FAILED' : 'SUCCEEDED';
            pendingToolTraces[traceId].outputPreview = result.trim().split('\n')[0].slice(0, 80);
            pendingToolTraces[traceId].finishedAt = Date.now();
            asstMsg.toolTracesJson = JSON.stringify(Object.values(pendingToolTraces));
            if (userId) await dbUpsertMessage(userId, convId, { ...asstMsg });
          }
        }
        else if (dtype === 'function_result') {
          const isErr = delta.is_error === true;
          const traceId = Object.keys(pendingToolTraces).find(k => pendingToolTraces[k].status === 'RUNNING' && pendingToolTraces[k].name !== 'run_code');
          if (traceId) {
            pendingToolTraces[traceId].status = isErr ? 'FAILED' : 'SUCCEEDED';
            pendingToolTraces[traceId].finishedAt = Date.now();
            asstMsg.toolTracesJson = JSON.stringify(Object.values(pendingToolTraces));
            if (userId) await dbUpsertMessage(userId, convId, { ...asstMsg });
          }
        }
        else {
          const text = delta.text || delta.content?.text || '';
          if (text && text !== '\u0000ORCH_TURN\u0000') {
            textAccum += text;
            await flushText(false);
          }
        }
      }

      else if (et === 'interaction.completed') {
        gotCompleted = true;
        const envId = chunk.interaction?.environment_id;
        if (envId) activeEnvironmentId = envId;
        const u = chunk.interaction?.usage;
        if (u) {
          const inp = (u.total_input_tokens || 0) + (u.total_thought_tokens || 0);
          const out = u.total_output_tokens || 0;
          if (inp > inputTok) inputTok = inp;
          if (out > outputTok) outputTok = out;
        }
        await flushText(true);
        asstMsg.isStreaming = false;
        asstMsg.toolTracesJson = JSON.stringify(Object.values(pendingToolTraces));
        if (userId) {
          if (pendingArtifacts.length > 0 && envId) {
            const artifact = pendingArtifacts[pendingArtifacts.length - 1];
            const gcpBase = process.env.GCP_FUNCTION_URL || '';
            asstMsg.artifactJson = JSON.stringify({
              title: artifact.fileName,
              mimeType: artifact.mimeType,
              localUri: '',
              remoteUrl: gcpBase ? `${gcpBase.replace(/\/$/, '')}/sandbox-file?environmentId=${encodeURIComponent(envId)}&fileName=${encodeURIComponent(artifact.fileName)}` : '',
              storagePath: null,
              createdAt: Date.now(),
            });
          }
          await dbUpsertMessage(userId, convId, { ...asstMsg });
          await dbUpsertConversation(userId, convId,
            userText.slice(0, 30) + (userText.length > 30 ? '…' : '') || 'New Chat',
            'completed', chunk.interaction?.id || bodyObj?.previous_interaction_id || null,
            activeEnvironmentId);
        }
      }
    }

    if (!gotCompleted) {
      console.error('[antigravity] stream ended without interaction.completed');
      res.write('event: error\ndata: {"error":"stream_incomplete","message":"Agent response was cut short. Please try again."}\n\n');
      await flushText(true);
      asstMsg.isStreaming = false;
      if (userId) {
        await dbUpsertMessage(userId, convId, { ...asstMsg });
        await dbUpsertConversation(userId, convId, userText.slice(0, 30) || 'New Chat', 'error', null, activeEnvironmentId);
      }
    }

  } catch (err) {
    if (err.status === 429 && keyInfo.pool.keys.length > 1 && attempt < keyInfo.pool.keys.length) {
      clearInterval(forceFlushInterval);
      getApiKey('GOOGLE_GENERATIVE_AI_API_KEY', true);
      return handleAntigravity(req, res, userId, attempt + 1);
    }
    console.error('Antigravity upstream error:', err);
    await flushText(true).catch(() => {});
    asstMsg.isStreaming = false;
    if (userId) {
      await dbUpsertMessage(userId, convId, { ...asstMsg }).catch(() => {});
      await dbUpsertConversation(userId, convId, userText.slice(0, 30) || 'New Chat', 'error', null, activeEnvironmentId).catch(() => {});
    }
    if (!res.headersSent) res.status(502).json({ error: `Upstream Proxy Error: ${err.message}` });
  } finally {
    clearInterval(forceFlushInterval);
    if (res.headersSent) {
      try { recordUsage(userId, inputTok, outputTok); } catch (e) { }
      res.end();
    }
  }
}
async function handleUpload(req, res, userId) {
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = req.body; }
  const { fileName, mimeType, base64Data } = body || {};
  if (!fileName || !mimeType || !base64Data) return res.status(400).json({ error: 'Missing fileName, mimeType, or base64Data' });
  try {
    const uniquePath = `uploads/user-${userId}/${Date.now()}/${fileName}`;
    const file = storage.bucket(GCS_BUCKET_NAME).file(uniquePath);
    await file.save(Buffer.from(base64Data, 'base64'), { metadata: { contentType: mimeType } });
    const url = `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${uniquePath}`;
    res.json({ path: uniquePath, url });
  } catch (err) {
    console.error('Upload GCS error:', err);
    res.status(500).json({ error: err.message });
  }
}
function extractFileFromTar(tarBuffer, targetFileName) {
  return new Promise((resolve, reject) => {
    let fileData = null;
    let bufferToParse = tarBuffer;
    if (tarBuffer.length > 2 && tarBuffer[0] === 0x1f && tarBuffer[1] === 0x8b) {
      try {
        bufferToParse = require('zlib').gunzipSync(tarBuffer);
      } catch (err) {
        return reject(err);
      }
    }
    const parser = new tar.Parser();
    parser.on('entry', entry => {
      const entryPath = entry.path.replace(/\\/g, '/');
      if (entryPath.toLowerCase() === targetFileName.toLowerCase() || entryPath.toLowerCase().endsWith('/' + targetFileName.toLowerCase())) {
        const chunks = [];
        entry.on('data', chunk => chunks.push(chunk));
        entry.on('end', () => { fileData = Buffer.concat(chunks); });
      } else {
        entry.resume();
      }
    });
    parser.on('end', () => resolve(fileData));
    parser.on('error', reject);
    parser.end(bufferToParse);
  });
}
async function handleSandboxFile(req, res) {
  const { environmentId, fileName } = req.query;
  const userId = req.user?.id;
  if (!environmentId || !fileName) return res.status(400).json({ error: 'Missing environmentId or fileName' });
  const keyInfo = getApiKey('GOOGLE_GENERATIVE_AI_API_KEY', false);
  if (!keyInfo) return res.status(500).json({ error: 'Server key missing' });
  try {
    const mimeType = mime.lookup(fileName) || 'application/octet-stream';
    const storagePath = `artifacts/${userId}/${environmentId}/${fileName}`;
    const bucket = admin.storage().bucket();
    const fileRef = bucket.file(storagePath);
    const encodedPath = encodeURIComponent(storagePath);

    const [exists] = await fileRef.exists();
    if (exists) {
      const [metadata] = await fileRef.getMetadata();
      const token = metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
      const url = token
        ? `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
        : (await fileRef.getSignedUrl({ action: 'read', expires: '03-01-2500' }))[0];
      return res.json({ url, storagePath, mimeType, fileName });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/environment-${environmentId}:download?alt=media`, {
      method: 'GET',
      headers: { 'x-goog-api-key': keyInfo.value }
    });
    if (!response.ok) return res.status(response.status).json({ error: `Tar download failed: ${await response.text()}` });
    const fileBytes = await extractFileFromTar(Buffer.from(await response.arrayBuffer()), fileName);
    if (!fileBytes) return res.status(404).json({ error: `File ${fileName} not found in sandbox` });

    await fileRef.save(fileBytes, { metadata: { contentType: mimeType } });
    const [metadata] = await fileRef.getMetadata();
    const token = metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
    const url = token
      ? `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
      : (await fileRef.getSignedUrl({ action: 'read', expires: '03-01-2500' }))[0];
    res.json({ url, storagePath, mimeType, fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
async function handleEmbeddings(req, res) {
  const keyInfo = getApiKey('GOOGLE_GENERATIVE_AI_API_KEY', false);
  if (!keyInfo) return res.status(500).json({ error: 'Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.' });
  const { input, model } = req.body || {};
  if (!input) return res.status(400).json({ error: 'Missing input parameter' });
  try {
    const ai = new GoogleGenAI({ apiKey: keyInfo.value });
    const targetModel = model || 'gemini-embedding-2';
    const inputs = Array.isArray(input) ? input : [input];
    const results = await Promise.all(
      inputs.map(async (text, idx) => {
        const response = await ai.models.embedContent({
          model: targetModel,
          contents: typeof text === 'string' ? text : String(text)
        });
        return { object: 'embedding', embedding: response.embedding?.values || [], index: idx };
      })
    );
    res.json({ object: 'list', data: results, model: targetModel, usage: { prompt_tokens: inputs.length, total_tokens: inputs.length } });
  } catch (err) {
    res.status(500).json({ error: `Embedding failed: ${err.message}` });
  }
}

async function handleTitle(req, res) {
  const keyInfo = getApiKey('GOOGLE_GENERATIVE_AI_API_KEY', false);
  if (!keyInfo) return res.status(500).json({ error: 'Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.' });
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt parameter' });
  try {
    const ai = new GoogleGenAI({ apiKey: keyInfo.value });
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `Generate a concise, 3 to 6 word title summarizing this user prompt. Do not use quotes or punctuation.\n\nUser prompt: ${prompt}`
    });
    const title = (response.text || '').trim().replace(/^["']|["']$/g, '');
    res.json({ title });
  } catch (err) {
    res.status(500).json({ error: `Title generation failed: ${err.message}` });
  }
}

app.all('*', async (req, res) => {
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
  if (req.method === 'GET' && path === '/sandbox-file') return handleSandboxFile(req, res);
  if (req.method === 'GET' && path === '/models') return handleModels(req, res);
  if (req.method === 'GET' && path === '/budget') return handleGetBudget(req, res, userId);
  if (path.startsWith('/opencode')) return handleOpenAICompat(req, res, { functionName: 'opencode', envKey: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai/zen' }, userId);
  if (req.method === 'POST' && path === '/tavily') return handleTavily(req, res);
  if (req.method === 'POST' && path === '/transcribe') return handleTranscribe(req, res);
  if (req.method === 'POST' && path === '/generate-image') return handleGenerateImage(req, res);
  if (req.method === 'POST' && path === '/embeddings') return handleEmbeddings(req, res);
  if (req.method === 'POST' && path === '/title') return handleTitle(req, res);
  if (req.method === 'POST' && path === '/upload') return handleUpload(req, res, userId);
  if (req.method === 'POST' && path === '/antigravity') return handleAntigravity(req, res, userId);
  res.status(404).json({ error: `Not Found: ${req.path}` });
});
functions.http('api', app);
