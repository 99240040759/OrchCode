const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3';

const TOOLKITS = ['github', 'slack', 'googledrive', 'gmail', 'jira', 'notion'];
const SLUG_PATTERN = /^[A-Z0-9_]+$/;
const ACCOUNT_STATUSES = ['ACTIVE', 'INITIALIZING'];
const MAX_SLUGS = 100;

class UpstreamUnreachable extends Error {}

function config() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const callbackUrl = process.env.COMPOSIO_CALLBACK_URL;
  const rawIds = process.env.COMPOSIO_AUTH_CONFIG_IDS;
  if (!apiKey || !callbackUrl || !rawIds) {
    throw new Error('Composio is not configured: COMPOSIO_API_KEY, COMPOSIO_CALLBACK_URL and COMPOSIO_AUTH_CONFIG_IDS are required');
  }
  return { apiKey, callbackUrl, authConfigIds: JSON.parse(rawIds) };
}

async function composio(method, path, { query, body, timeoutMs = 20_000 } = {}) {
  const { apiKey } = config();
  const url = new URL(`${COMPOSIO_BASE}${path}`);
  for (const [key, values] of Object.entries(query || {})) {
    for (const value of [].concat(values)) url.searchParams.append(key, value);
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new UpstreamUnreachable(err?.message || 'Composio request failed');
  }
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

function upstreamMessage(json) {
  return json?.error?.message || (typeof json?.error === 'string' ? json.error : null) || 'Composio request failed';
}

function relayFailure(res, upstream) {
  const passthrough = new Set([400, 404, 408, 413, 422, 429]);
  const status = passthrough.has(upstream.status) ? upstream.status : 502;
  const code = typeof upstream.json?.error?.slug === 'string' ? upstream.json.error.slug : 'COMPOSIO_ERROR';
  const error = status === 502 ? 'The connector service returned an error. Please retry.' : upstreamMessage(upstream.json);
  return res.status(status).json({ error, code });
}

function toolkitOf(slug) {
  const prefix = (name) => `${name.toUpperCase()}_`;
  return TOOLKITS.find((name) => slug.startsWith(prefix(name))) || null;
}

function validSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug) && toolkitOf(slug) !== null;
}

async function listAccounts(userId, { toolkit, statuses, ids } = {}) {
  const query = {
    user_ids: userId,
    statuses: statuses || ACCOUNT_STATUSES,
    toolkit_slugs: toolkit || TOOLKITS,
    limit: '100',
  };
  if (ids) query.connected_account_ids = ids;
  const upstream = await composio('GET', '/connected_accounts', { query });
  if (upstream.status !== 200) return { failure: upstream };
  const items = (upstream.json?.items || []).filter((item) => !item.is_disabled);
  return {
    accounts: items.map((item) => ({
      id: item.id,
      toolkit: item.toolkit?.slug,
      status: item.status,
    })),
  };
}

async function handleAccounts(req, res, userId) {
  const result = await listAccounts(userId, { statuses: ['ACTIVE'] });
  if (result.failure) return relayFailure(res, result.failure);
  return res.json({ accounts: result.accounts });
}

async function handleConnect(req, res, userId) {
  const toolkit = req.body?.toolkit;
  if (!TOOLKITS.includes(toolkit)) {
    return res.status(400).json({ error: 'Unknown connector', code: 'UNKNOWN_CONNECTOR' });
  }
  const { authConfigIds, callbackUrl } = config();
  const authConfigId = authConfigIds[toolkit];
  if (!authConfigId) {
    return res.status(503).json({ error: 'This connector is not configured yet', code: 'CONNECTOR_NOT_CONFIGURED' });
  }

  const existing = await listAccounts(userId, { toolkit: [toolkit] });
  if (existing.failure) return relayFailure(res, existing.failure);
  if (existing.accounts.some((account) => account.status === 'ACTIVE')) {
    return res.status(409).json({ error: 'This connector is already connected', code: 'ALREADY_CONNECTED' });
  }
  for (const stale of existing.accounts) {
    const removed = await composio('DELETE', `/connected_accounts/${encodeURIComponent(stale.id)}`);
    if (removed.status !== 200) return relayFailure(res, removed);
  }

  const link = await composio('POST', '/connected_accounts/link', {
    body: { auth_config_id: authConfigId, user_id: userId, callback_url: callbackUrl },
  });
  if (link.status !== 201 || typeof link.json?.redirect_url !== 'string') return relayFailure(res, link);
  return res.json({ redirectUrl: link.json.redirect_url });
}

async function handleDisconnect(req, res, userId, accountId) {
  const owned = await listAccounts(userId, { statuses: ['ACTIVE', 'INITIALIZING'], ids: [accountId] });
  if (owned.failure) return relayFailure(res, owned.failure);
  if (!owned.accounts.some((account) => account.id === accountId)) {
    return res.status(404).json({ error: 'Connection not found', code: 'CONNECTION_NOT_FOUND' });
  }
  const removed = await composio('DELETE', `/connected_accounts/${encodeURIComponent(accountId)}`);
  if (removed.status !== 200) return relayFailure(res, removed);
  return res.json({ ok: true });
}

async function handleTools(req, res) {
  const slugs = String(req.query.slugs || '').split(',').filter(Boolean);
  if (slugs.length === 0 || slugs.length > MAX_SLUGS || !slugs.every(validSlug)) {
    return res.status(400).json({ error: 'slugs must list 1 to 100 supported tool slugs', code: 'BAD_SLUGS' });
  }
  const upstream = await composio('GET', '/tools', {
    query: { tool_slugs: slugs.join(','), toolkit_versions: 'latest', limit: String(MAX_SLUGS) },
    timeoutMs: 30_000,
  });
  if (upstream.status !== 200) return relayFailure(res, upstream);
  const tools = (upstream.json?.items || []).map((item) => ({
    slug: item.slug,
    name: item.name,
    description: item.description,
    version: item.version,
    isDeprecated: item.is_deprecated === true,
    tags: item.tags || [],
    inputParameters: item.input_parameters,
  }));
  return res.json({ tools });
}

async function handleExecute(req, res, userId) {
  const { slug, version, arguments: args } = req.body || {};
  if (!validSlug(slug)) {
    return res.status(400).json({ error: 'Unsupported tool', code: 'BAD_SLUG' });
  }
  if (typeof version !== 'string' || !version) {
    return res.status(400).json({ error: 'version is required', code: 'BAD_VERSION' });
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return res.status(400).json({ error: 'arguments must be an object', code: 'BAD_ARGUMENTS' });
  }
  const upstream = await composio('POST', `/tools/execute/${slug}`, {
    body: { user_id: userId, version, arguments: args },
    timeoutMs: 120_000,
  });
  if (upstream.status !== 200) return relayFailure(res, upstream);
  return res.json({
    data: upstream.json?.data ?? null,
    error: upstream.json?.error ?? null,
    successful: upstream.json?.successful === true,
  });
}

async function handleComposio(req, res, userId) {
  const path = req.normalizedPath.replace(/^\/composio/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/accounts') return await handleAccounts(req, res, userId);
    if (req.method === 'POST' && path === '/connect') return await handleConnect(req, res, userId);
    if (req.method === 'GET' && path === '/tools') return await handleTools(req, res);
    if (req.method === 'POST' && path === '/execute') return await handleExecute(req, res, userId);
    const removal = path.match(/^\/accounts\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'DELETE' && removal) return await handleDisconnect(req, res, userId, removal[1]);
    return res.status(404).json({ error: `Not Found: ${req.path}` });
  } catch (err) {
    if (err instanceof UpstreamUnreachable) {
      console.error('[Composio] unreachable', err.message);
      return res.status(504).json({ error: 'The connector service did not respond in time. Please retry.', code: 'UPSTREAM_TIMEOUT' });
    }
    throw err;
  }
}

module.exports = { handleComposio };
