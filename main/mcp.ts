import log from 'electron-log'
import { getMcpServers, saveMcpServer, updateMcpServer, deleteMcpServer } from './db'
import crypto from 'node:crypto'

// Dynamic imports for MCP SDK (ESM module)
let ClientModule: any = null
let StdioModule: any = null
let SSEModule: any = null

async function loadMcpModules() {
  if (!ClientModule) {
    ClientModule = await import('@modelcontextprotocol/sdk/client/index.js')
    StdioModule = await import('@modelcontextprotocol/sdk/client/stdio.js')
    SSEModule = await import('@modelcontextprotocol/sdk/client/sse.js')
  }
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  config: {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }
  enabled: boolean
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  serverId: string
  serverName: string
}

interface ConnectedServer {
  client: any
  transport: any
  config: McpServerConfig
  tools: McpToolDefinition[]
}

class McpManager {
  private servers = new Map<string, ConnectedServer>()

  async connectServer(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) await this.disconnectServer(config.id)
    try {
      await loadMcpModules()
      const { Client } = ClientModule
      const client = new Client({ name: 'orch-code', version: '1.0.0' }, { capabilities: {} })
      let transport: any
      if (config.transport === 'stdio') {
        if (!config.config.command) throw new Error('stdio transport requires a command')
        const { StdioClientTransport } = StdioModule
        transport = new StdioClientTransport({
          command: config.config.command,
          args: config.config.args || [],
          env: { ...process.env, ...(config.config.env || {}) } as Record<string, string>
        })
      } else {
        if (!config.config.url) throw new Error('SSE transport requires a URL')
        const { SSEClientTransport } = SSEModule
        transport = new SSEClientTransport(new URL(config.config.url), {
          requestInit: { headers: config.config.headers || {} }
        })
      }
      await client.connect(transport)
      const toolsResult = await client.listTools()
      const tools: McpToolDefinition[] = (toolsResult.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        serverId: config.id,
        serverName: config.name
      }))
      this.servers.set(config.id, { client, transport, config, tools })
      log.info(`[mcp] Connected to ${config.name} (${tools.length} tools)`)
    } catch (err: any) {
      log.error(`[mcp] Failed to connect to ${config.name}:`, err.message)
      throw err
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) return
    try {
      await server.transport.close()
    } catch (err: any) { log.debug(`[mcp] Error closing ${id}:`, err.message) }
    this.servers.delete(id)
    log.info(`[mcp] Disconnected ${id}`)
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.servers.keys()]
    for (const id of ids) await this.disconnectServer(id)
  }

  getConnectedServers(): Map<string, ConnectedServer> { return this.servers }

  getServerStatus(id: string): 'connected' | 'disconnected' {
    return this.servers.has(id) ? 'connected' : 'disconnected'
  }

  getAllMcpTools(): Record<string, { description: string; inputSchema: any; serverId: string; serverName: string; execute: (args: any) => Promise<any> }> {
    const tools: Record<string, any> = {}
    for (const [, server] of this.servers) {
      for (const t of server.tools) {
        const fullName = `mcp__${server.config.name}__${t.name}`
        tools[fullName] = {
          description: `[MCP: ${server.config.name}] ${t.description}`,
          inputSchema: t.inputSchema,
          serverId: server.config.id,
          serverName: server.config.name,
          execute: async (args: any) => {
            const result = await server.client.callTool({ name: t.name, arguments: args })
            if (result.isError) throw new Error(result.content?.[0]?.text || 'MCP tool error')
            return result.content?.map((c: any) => c.text || JSON.stringify(c)).join('\n') || 'Done'
          }
        }
      }
    }
    return tools
  }

  async executeMcpTool(fullToolName: string, args: any): Promise<any> {
    const tools = this.getAllMcpTools()
    const tool = tools[fullToolName]
    if (!tool) throw new Error(`MCP tool not found: ${fullToolName}`)
    return await tool.execute(args)
  }

  async refreshConnections(): Promise<void> {
    const configs = await getMcpServers() as any[]
    const enabledIds = new Set<string>()
    for (const row of configs) {
      if (!row.enabled) continue
      enabledIds.add(row.id)
      const config: McpServerConfig = {
        id: row.id, name: row.name, transport: row.transport,
        config: JSON.parse(row.config || '{}'), enabled: !!row.enabled
      }
      if (!this.servers.has(row.id)) {
        try { await this.connectServer(config) }
        catch (err: any) { log.error(`[mcp] Auto-connect failed for ${row.name}:`, err.message) }
      }
    }
    for (const id of this.servers.keys()) {
      if (!enabledIds.has(id)) await this.disconnectServer(id)
    }
  }

  async addServer(name: string, transport: 'stdio' | 'sse', config: any, enabled = true): Promise<string> {
    const id = crypto.randomUUID()
    await saveMcpServer(id, name, transport, JSON.stringify(config), enabled)
    if (enabled) {
      try { await this.connectServer({ id, name, transport, config, enabled }) }
      catch {} // logged in connectServer
    }
    return id
  }

  async removeServer(id: string): Promise<void> {
    await this.disconnectServer(id)
    await deleteMcpServer(id)
  }

  async toggleServer(id: string, enabled: boolean): Promise<void> {
    const configs = await getMcpServers() as any[]
    const row = configs.find((r: any) => r.id === id)
    if (!row) throw new Error('Server not found')
    await updateMcpServer(id, row.name, row.transport, row.config, enabled)
    if (enabled) {
      const config: McpServerConfig = { id, name: row.name, transport: row.transport, config: JSON.parse(row.config || '{}'), enabled: true }
      try { await this.connectServer(config) }
      catch {} 
    } else {
      await this.disconnectServer(id)
    }
  }

  async testConnection(config: Omit<McpServerConfig, 'id' | 'enabled'>): Promise<{ success: boolean; toolCount: number; error?: string }> {
    const testId = `test-${crypto.randomUUID()}`
    try {
      await this.connectServer({ ...config, id: testId, enabled: true })
      const server = this.servers.get(testId)
      const toolCount = server?.tools.length ?? 0
      await this.disconnectServer(testId)
      return { success: true, toolCount }
    } catch (err: any) {
      await this.disconnectServer(testId).catch(() => {})
      return { success: false, toolCount: 0, error: err.message }
    }
  }

  getToolsList(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = []
    for (const [, server] of this.servers) tools.push(...server.tools)
    return tools
  }
}

export const mcpManager = new McpManager()
