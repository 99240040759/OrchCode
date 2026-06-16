/**
 * test-models.ts — Direct API test for model compatibility
 * Run with: npx tsx main/test-models.ts
 * Tests tool calling, streaming, and payload shape per provider
 */
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'

// --- Config ---
const API_BASE = process.env.API_BASE || 'https://us-central1-orch-code-prod.cloudfunctions.net/api'
const SUPABASE_ANON_KEY = 'sb_publishable_HgJyamXmCpki8DZR6Ad7Vw_xrp8e9vB'
const AUTH_TOKEN = process.env.AUTH_TOKEN // Pass your JWT via env
if (!AUTH_TOKEN) { console.error('ERROR: Set AUTH_TOKEN env var to your Supabase JWT'); process.exit(1) }

// --- Test tool schemas (mirrors real app schemas) ---
const testTools = {
  list_dir: {
    description: 'Lists files and subdirectories in a directory.',
    inputSchema: z.object({ directory_path: z.string().describe('Path of directory to list.') }),
  },
  view_file: {
    description: 'Reads text content of a file.',
    inputSchema: z.object({
      absolute_path: z.string().describe('Path of the file to read.'),
      start_line: z.number().int().min(1).optional().describe('1-indexed start line.'),
      end_line: z.number().int().min(1).optional().describe('1-indexed end line.'),
    }),
  },
  run_command: {
    description: 'Runs a shell command.',
    inputSchema: z.object({
      command_line: z.string().max(4096).describe('Command to execute.'),
      cwd: z.string().optional().describe('Working directory.'),
      wait_ms_before_async: z.number().int().min(0).max(180000).optional().default(60000).describe('Timeout ms.'),
    }),
  },
}

// --- Schema sanitizer (matches models.ts) ---
function sanitizeJsonSchema(schema: any, stripDefault: boolean): any {
  if (!schema || typeof schema !== 'object') return schema
  const clean = { ...schema }
  delete clean.$schema; delete clean.definitions; delete clean.$defs
  if (stripDefault) delete clean.default
  if (clean.anyOf && Array.isArray(clean.anyOf)) {
    const real = clean.anyOf.filter((s: any) => !s.not && s.type !== 'null')
    if (real.length === 1) { const { anyOf, ...rest } = clean; return sanitizeJsonSchema({ ...rest, ...real[0] }, stripDefault) }
  }
  if (clean.oneOf && Array.isArray(clean.oneOf)) {
    const real = clean.oneOf.filter((s: any) => !s.not && s.type !== 'null')
    if (real.length === 1) { const { oneOf, ...rest } = clean; return sanitizeJsonSchema({ ...rest, ...real[0] }, stripDefault) }
  }
  if (clean.properties) { for (const [k, v] of Object.entries(clean.properties)) clean.properties[k] = sanitizeJsonSchema(v, stripDefault) }
  if (clean.items) clean.items = sanitizeJsonSchema(clean.items, stripDefault)
  return clean
}

function buildTools(stripDefault: boolean) {
  return Object.entries(testTools).map(([name, t]) => {
    let schema = zodToJsonSchema(t.inputSchema, { target: 'openApi3', $refStrategy: 'none' })
    schema = sanitizeJsonSchema(schema, stripDefault)
    return { type: 'function', function: { name, description: t.description, parameters: schema } }
  })
}

// --- Provider test configs ---
interface TestConfig { name: string; provider: string; model: string; baseUrl: string; stripDefault: boolean; stripParams: string[] }
const TESTS: TestConfig[] = [
  {
    name: 'GLM 4.5 Flash (z-ai)',
    provider: 'z-ai', model: 'GLM-4.5-Flash',
    baseUrl: `${API_BASE}/z-ai/v1/chat/completions`,
    stripDefault: true,
    stripParams: ['parallel_tool_calls', 'stream_options', 'frequency_penalty', 'presence_penalty'],
  },
  {
    name: 'DeepSeek V4 Flash (opencode)',
    provider: 'opencode', model: 'deepseek-v4-flash-free',
    baseUrl: `${API_BASE}/opencode/v1/chat/completions`,
    stripDefault: false,
    stripParams: [],
  },
]

// --- Run test ---
async function testProvider(config: TestConfig) {
  console.log(`\n${'='.repeat(60)}\n🧪 Testing: ${config.name}\n${'='.repeat(60)}`)
  const tools = buildTools(config.stripDefault)
  const payload: any = {
    model: config.model,
    messages: [
      { role: 'system', content: 'You are a helpful coding assistant. Use the tools provided to answer questions.' },
      { role: 'user', content: 'List the files in the current directory using the list_dir tool.' },
    ],
    tools,
    tool_choice: 'auto',
    temperature: 0.35,
    max_tokens: 4096,
    stream: true,
  }
  // Strip unsupported params
  for (const p of config.stripParams) delete payload[p]
  console.log('\n📤 Request payload keys:', Object.keys(payload))
  console.log('📤 Tools sent:', tools.map(t => t.function.name))
  // Log one tool schema for inspection
  console.log('\n📋 run_command schema (sanitized):', JSON.stringify(tools.find(t => t.function.name === 'run_command')?.function.parameters, null, 2))
  try {
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    console.log(`\n📥 Response status: ${response.status}`)
    if (!response.ok) {
      const errText = await response.text()
      console.error(`❌ Error response: ${errText}`)
      return { success: false, provider: config.name, error: errText }
    }
    // Parse SSE stream
    const text = await response.text()
    const lines = text.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'))
    let fullContent = '', toolCalls: any[] = [], usage: any = null
    const accumulators = new Map<number, { id: string; name: string; args: string }>()
    for (const line of lines) {
      try {
        const json = JSON.parse(line.replace('data: ', ''))
        if (json.usage) usage = json.usage
        const choice = json.choices?.[0]
        if (!choice) continue
        const delta = choice.delta
        if (delta?.content) fullContent += delta.content
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            let acc = accumulators.get(idx)
            if (!acc) { acc = { id: tc.id || '', name: '', args: '' }; accumulators.set(idx, acc) }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
          }
        }
      } catch {}
    }
    for (const [, acc] of accumulators) {
      try { toolCalls.push({ id: acc.id, name: acc.name, args: JSON.parse(acc.args) }) } catch { toolCalls.push({ id: acc.id, name: acc.name, args_raw: acc.args }) }
    }
    console.log('\n📝 Content:', fullContent || '(none)')
    console.log('🔧 Tool calls:', JSON.stringify(toolCalls, null, 2))
    console.log('📊 Usage:', JSON.stringify(usage, null, 2))
    const hasToolCall = toolCalls.length > 0 && toolCalls.some(tc => tc.name === 'list_dir')
    console.log(`\n${hasToolCall ? '✅' : '⚠️'} Tool call ${hasToolCall ? 'DETECTED' : 'NOT DETECTED'} for list_dir`)
    // --- Phase 2: Send tool result back ---
    if (hasToolCall) {
      console.log('\n--- Phase 2: Sending tool result back ---')
      const assistantMsg: any = { role: 'assistant', content: fullContent || '' }
      if (toolCalls.length) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }))
      }
      const toolResultMsg = { role: 'tool', tool_call_id: toolCalls[0].id, name: 'list_dir', content: '✅ SUCCESS — Tool: list_dir\n[DIR] src/ (12 items)\n[DIR] node_modules/ (340 items)\n[FILE] package.json (1234 bytes)\n[FILE] tsconfig.json (456 bytes)' }
      const p2payload: any = { ...payload, messages: [...payload.messages, assistantMsg, toolResultMsg], stream: false }
      delete p2payload.stream_options
      const r2 = await fetch(config.baseUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(p2payload),
      })
      if (r2.ok) {
        const j2 = await r2.json()
        const reply = j2.choices?.[0]?.message?.content
        console.log('📝 Follow-up response:', reply?.slice(0, 300) || '(none)')
        console.log('✅ Full round-trip (request → tool call → result → response) PASSED')
      } else {
        console.error('❌ Phase 2 failed:', r2.status, await r2.text())
      }
    }
    return { success: true, provider: config.name, hasToolCall, toolCalls }
  } catch (err: any) {
    console.error(`❌ Fetch error: ${err.message}`)
    return { success: false, provider: config.name, error: err.message }
  }
}

async function main() {
  console.log('🚀 Model Compatibility Test Suite')
  console.log(`API Base: ${API_BASE}`)
  const results: Array<{ success: boolean; provider: string; hasToolCall?: boolean; toolCalls?: any[]; error?: any }> = []
  for (const test of TESTS) {
    results.push(await testProvider(test))
  }
  console.log('\n\n' + '='.repeat(60))
  console.log('📊 RESULTS SUMMARY')
  console.log('='.repeat(60))
  for (const r of results) {
    console.log(`${r.success ? '✅' : '❌'} ${r.provider}: ${r.success ? (r.hasToolCall ? 'Tool calling works' : 'No tool call detected') : r.error}`)
  }
}

main().catch(console.error)
