import React, { useState, useEffect, useCallback } from 'react'
import { User, Shield, Plug, BarChart3, RefreshCw, Plus, Trash2, ToggleLeft, ToggleRight, TestTube, Save, Brain, X, ChevronDown, Check } from 'lucide-react'
import Dropdown, { DropdownItem } from './Dropdown'
import Tooltip from './Tooltip'
import { permissionService, memoryService, mcpService, usageService, quotaService, authService } from '../services/services'
import type { UserProfile } from '../../preload/index.d'

type Tab = 'profile' | 'permissions' | 'mcp' | 'memory' | 'usage'
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={15} /> },
  { id: 'permissions', label: 'Permissions', icon: <Shield size={15} /> },
  { id: 'mcp', label: 'MCP Servers', icon: <Plug size={15} /> },
  { id: 'memory', label: 'Memory', icon: <Brain size={15} /> },
  { id: 'usage', label: 'Usage & Cost', icon: <BarChart3 size={15} /> },
]
const TOOL_FRIENDLY: Record<string, { label: string; category: string }> = {
  list_dir: { label: 'List Directory', category: 'File System' },
  view_file: { label: 'View File', category: 'File System' },
  write_to_file: { label: 'Write File', category: 'File System' },
  multi_replace_file_content: { label: 'Edit File', category: 'File System' },
  search_workspace: { label: 'Search Workspace', category: 'File System' },
  run_command: { label: 'Run Command', category: 'Shell' },
  search_web: { label: 'Web Search', category: 'Web' },
  generate_image: { label: 'Generate Image', category: 'Media' },
  save_memory: { label: 'Save Memory', category: 'Memory' },
  browser_navigate: { label: 'Navigate Browser', category: 'Browser' },
  browser_click: { label: 'Click Element', category: 'Browser' },
  browser_type: { label: 'Type Text', category: 'Browser' },
  browser_keyboard_press: { label: 'Press Key', category: 'Browser' },
  browser_screenshot: { label: 'Take Screenshot', category: 'Browser' },
  browser_get_page_content: { label: 'Get Page Content', category: 'Browser' },
}
const friendlyName = (t: string) => TOOL_FRIENDLY[t]?.label || t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const toolCategory = (t: string) => TOOL_FRIENDLY[t]?.category || (t.startsWith('mcp__') ? 'MCP' : 'Other')
const PERM_LABELS: Record<string, string> = { always_allow: 'Always Allow', always_ask: 'Always Ask', always_deny: 'Always Deny' }

// ─── Permission Dropdown (Radix) ────────────────────
const PermDropdown: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <Dropdown align="end" sideOffset={4} className="dropdown-menu-content-sm" trigger={
    <button className="settings-perm-trigger"><span>{PERM_LABELS[value] || value}</span><ChevronDown size={12} /></button>
  }>
    {['always_allow', 'always_ask', 'always_deny'].map(p => (
      <DropdownItem key={p} onSelect={() => onChange(p)} className={`app-dropdown-item${value === p ? ' selected' : ''}`}>
        {value === p && <Check size={12} />}<span>{PERM_LABELS[p]}</span>
      </DropdownItem>
    ))}
  </Dropdown>
)

// ─── Profile ─────────────────────────────────────────
const ProfileTab: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null)
  useEffect(() => { authService.getAuthUser().then(u => setUser(u)) }, [])
  if (!user) return <div className="settings-empty">Not signed in</div>
  return (
    <div className="settings-section">
      <div className="settings-card">
        {user.photoUrl ? <img src={user.photoUrl} className="profile-avatar-img" style={{ width: 48, height: 48 }} referrerPolicy="no-referrer" /> : <div className="profile-avatar-fallback" style={{ width: 48, height: 48, fontSize: 18 }}>{user.name?.charAt(0) || user.email.charAt(0)}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--font-size-md-plus)', fontWeight: 600 }}>{user.name || 'User'}</span>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{user.email}</span>
          <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>UID: {user.uid}</span>
        </div>
      </div>
      <button className="settings-action-btn settings-action-danger" onClick={() => authService.logout()}>Log Out</button>
    </div>
  )
}

// ─── Permissions ─────────────────────────────────────
const PermissionsTab: React.FC = () => {
  const [perms, setPerms] = useState<Record<string, string>>({})
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const [all, def] = await Promise.all([permissionService.getAll(), permissionService.getDefaults()])
    setPerms(all); setDefaults(def)
  }, [])
  useEffect(() => { load() }, [load])
  const handleChange = async (tool: string, perm: string) => { await permissionService.set(tool, perm); setPerms(p => ({ ...p, [tool]: perm })) }
  const handleReset = async () => { await permissionService.reset(); await load() }
  const allTools = Object.keys({ ...perms, ...defaults }).sort()
  const grouped: Record<string, string[]> = {}
  allTools.forEach(t => { const cat = toolCategory(t); (grouped[cat] ??= []).push(t) })
  const catOrder = ['File System', 'Shell', 'Web', 'Media', 'Browser', 'Memory', 'MCP', 'Other']
  const sortedCats = catOrder.filter(c => grouped[c]?.length)
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>Tool Permissions</h3>
        <Tooltip content="Reset all to defaults"><button className="settings-action-btn" onClick={handleReset}><RefreshCw size={13} /><span>Reset</span></button></Tooltip>
      </div>
      <p className="settings-hint">Control which tools require your approval before the agent can use them.</p>
      {sortedCats.map(cat => (
        <div key={cat} className="settings-group">
          <div className="settings-group-label">{cat}</div>
          {grouped[cat].map(tool => (
            <div key={tool} className="settings-row">
              <span className="settings-row-label">{friendlyName(tool)}</span>
              <PermDropdown value={perms[tool] || 'always_ask'} onChange={v => handleChange(tool, v)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── MCP ─────────────────────────────────────────────
const DEFAULT_SERVERS = [
  { name: 'GitHub', transport: 'stdio' as const, config: '{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}', desc: 'GitHub repos, issues, PRs' },
  { name: 'PostgreSQL', transport: 'stdio' as const, config: '{"command":"npx","args":["-y","@modelcontextprotocol/server-postgres","postgresql://localhost/mydb"]}', desc: 'Query PostgreSQL databases' },
  { name: 'Slack', transport: 'stdio' as const, config: '{"command":"npx","args":["-y","@modelcontextprotocol/server-slack"]}', desc: 'Slack channels & messages' },
  { name: 'Google Drive', transport: 'stdio' as const, config: '{"command":"npx","args":["-y","@modelcontextprotocol/server-gdrive"]}', desc: 'Google Drive files' },
  { name: 'Brave Search', transport: 'stdio' as const, config: '{"command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"]}', desc: 'Brave web search API' },
]

const McpTab: React.FC = () => {
  const [servers, setServers] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTransport, setNewTransport] = useState<'stdio' | 'sse'>('stdio')
  const [newConfig, setNewConfig] = useState('{"command": "", "args": []}')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{success: boolean; toolCount: number; error?: string} | null>(null)
  const load = useCallback(async () => { setServers(await mcpService.listServers()) }, [])
  useEffect(() => { load() }, [load])
  const handleAdd = async (name: string, transport: 'stdio'|'sse', configStr: string) => {
    try { await mcpService.addServer(name, transport, JSON.parse(configStr)); setShowAdd(false); setNewName(''); setNewConfig('{"command": "", "args": []}'); setTestResult(null); await load() }
    catch (err: any) { alert('Error: ' + err.message) }
  }
  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try { setTestResult(await mcpService.testConnection(newName || 'test', newTransport, JSON.parse(newConfig))) }
    catch (err: any) { setTestResult({ success: false, toolCount: 0, error: err.message }) }
    finally { setTesting(false) }
  }
  const handleToggle = async (id: string, enabled: boolean) => { await mcpService.toggleServer(id, !enabled); await load() }
  const handleDelete = async (id: string) => { await mcpService.deleteServer(id); await load() }
  const existingNames = new Set(servers.map(s => s.name))
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>MCP Servers</h3>
        <button className="settings-action-btn" onClick={() => setShowAdd(!showAdd)}>{showAdd ? <><X size={13} /><span>Cancel</span></> : <><Plus size={13} /><span>Custom</span></>}</button>
      </div>
      {showAdd && (
        <div className="settings-card" style={{ flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
          <input className="dialog-input" style={{ marginTop: 0 }} placeholder="Server name" value={newName} onChange={e => setNewName(e.target.value)} />
          <Dropdown align="start" sideOffset={4} className="dropdown-menu-content-sm" trigger={
            <button className="settings-perm-trigger" style={{ width: '100%', justifyContent: 'space-between' }}><span>{newTransport}</span><ChevronDown size={12} /></button>
          }>
            <DropdownItem onSelect={() => setNewTransport('stdio')} className={`app-dropdown-item${newTransport === 'stdio' ? ' selected' : ''}`}>stdio</DropdownItem>
            <DropdownItem onSelect={() => setNewTransport('sse')} className={`app-dropdown-item${newTransport === 'sse' ? ' selected' : ''}`}>SSE</DropdownItem>
          </Dropdown>
          <textarea className="dialog-input" style={{ marginTop: 0, fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical' }} placeholder='Config JSON' value={newConfig} onChange={e => setNewConfig(e.target.value)} rows={3} />
          {testResult && <div className={`settings-test-result ${testResult.success ? 'success' : 'error'}`}>{testResult.success ? `✓ Connected — ${testResult.toolCount} tools` : `✗ ${testResult.error}`}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="settings-action-btn" onClick={handleTest} disabled={testing}><TestTube size={13} /><span>{testing ? 'Testing...' : 'Test'}</span></button>
            <button className="settings-action-btn settings-action-primary" onClick={() => handleAdd(newName, newTransport, newConfig)} disabled={!newName}><Save size={13} /><span>Save</span></button>
          </div>
        </div>
      )}
      <div className="settings-group">
        <div className="settings-group-label">Quick Add</div>
        {DEFAULT_SERVERS.filter(d => !existingNames.has(d.name)).map(d => (
          <div key={d.name} className="settings-row" style={{ padding: '10px var(--space-sm)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{d.name}</span>
              <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--text-muted)' }}>{d.desc}</span>
            </div>
            <button className="settings-action-btn settings-action-primary" onClick={() => handleAdd(d.name, d.transport, d.config)}><Plus size={12} /><span>Add</span></button>
          </div>
        ))}
      </div>
      {servers.length > 0 && (
        <div className="settings-group">
          <div className="settings-group-label">Configured</div>
          {servers.map(s => (
            <div key={s.id} className="settings-row" style={{ padding: '10px var(--space-sm)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--text-muted)' }}>{s.transport} · {s.enabled ? '🟢 On' : '⚪ Off'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tooltip content={s.enabled ? 'Disable' : 'Enable'}><button className="sidebar-section-header-action" onClick={() => handleToggle(s.id, !!s.enabled)}>{s.enabled ? <ToggleRight size={20} style={{ color: 'var(--accent-green)' }} /> : <ToggleLeft size={20} />}</button></Tooltip>
                <Tooltip content="Delete"><button className="sidebar-section-header-action" onClick={() => handleDelete(s.id)}><Trash2 size={14} style={{ color: 'var(--accent-red)' }} /></button></Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Memory ──────────────────────────────────────────
const MemoryTab: React.FC = () => {
  const [memories, setMemories] = useState<any[]>([])
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const load = useCallback(async () => { setMemories(await memoryService.list()) }, [])
  useEffect(() => { load() }, [load])
  const handleSave = async () => { if (!newContent.trim()) return; await memoryService.save(newContent, newCategory); setNewContent(''); await load() }
  const handleDelete = async (id: string) => { await memoryService.delete(id); await load() }
  return (
    <div className="settings-section">
      <div className="settings-section-header"><h3>Saved Memories</h3></div>
      <p className="settings-hint">Memories persist across conversations. The agent recalls them automatically.</p>
      <div className="settings-card" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
        <textarea className="dialog-input" style={{ marginTop: 0, resize: 'vertical' }} placeholder="Add a memory the agent should remember..." value={newContent} onChange={e => setNewContent(e.target.value)} rows={2} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Dropdown align="start" sideOffset={4} className="dropdown-menu-content-sm" trigger={
            <button className="settings-perm-trigger"><span>{newCategory}</span><ChevronDown size={12} /></button>
          }>
            {['general', 'preference', 'codebase', 'workflow'].map(c => (
              <DropdownItem key={c} onSelect={() => setNewCategory(c)} className={`app-dropdown-item${newCategory === c ? ' selected' : ''}`}>{c}</DropdownItem>
            ))}
          </Dropdown>
          <button className="settings-action-btn settings-action-primary" onClick={handleSave} disabled={!newContent.trim()}><Plus size={12} /><span>Save</span></button>
        </div>
      </div>
      {memories.length === 0 && <div className="settings-empty">No memories saved yet</div>}
      {memories.map(m => (
        <div key={m.id} className="settings-row" style={{ alignItems: 'flex-start', gap: 12, padding: '10px var(--space-sm)' }}>
          <div style={{ flex: 1, fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>{m.content}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span className="settings-tag">{m.category}</span>
            <Tooltip content="Delete"><button className="sidebar-section-header-action" onClick={() => handleDelete(m.id)}><Trash2 size={12} style={{ color: 'var(--accent-red)' }} /></button></Tooltip>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Usage ───────────────────────────────────────────
const UsageTab: React.FC = () => {
  const [stats, setStats] = useState<{totalInput: number; totalOutput: number; totalLifetime: number} | null>(null)
  const [quota, setQuota] = useState<{allowed: boolean; remaining: number; cost_usd: number; limit_usd: number; period: string} | null>(null)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  useEffect(() => {
    usageService.getTotals().then(setStats)
    quotaService.get().then(setQuota).catch(e => setQuotaError(e?.message || 'Failed to load quota'))
  }, [])
  if (!stats) return <div className="settings-empty">Loading...</div>
  const fmt = (n: number) => n.toLocaleString()
  const fmtC = (n: number) => `$${n.toFixed(4)}`
  const pct = quota ? Math.min(100, (quota.cost_usd / Math.max(quota.limit_usd, 0.01)) * 100) : 0
  return (
    <div className="settings-section">
      <div className="settings-section-header"><h3>Server Quota</h3></div>
      {quotaError ? (
        <div className="settings-card" style={{ color: 'var(--text-muted)' }}>{quotaError}</div>
      ) : quota ? (
        <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Budget Period: <strong style={{ color: 'var(--text-primary)' }}>{quota.period}</strong></span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: quota.allowed ? 'var(--accent-green)' : 'var(--accent-red, #f44)' }}>{quota.allowed ? '● Active' : '● Exhausted'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <span>Used: <strong style={{ color: 'var(--text-primary)' }}>{fmtC(quota.cost_usd)}</strong></span>
            <span>Limit: <strong style={{ color: 'var(--text-primary)' }}>{fmtC(quota.limit_usd)}</strong></span>
          </div>
          <div style={{ width: '100%', height: 8, borderRadius: 4, background: 'var(--bg-input, #222)' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: pct > 90 ? 'var(--accent-red, #f44)' : pct > 70 ? 'var(--accent-brass, #d4a)' : 'var(--accent-green, #4f4)', transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'right' }}>Remaining: {fmtC(quota.remaining)}</span>
        </div>
      ) : (
        <div className="settings-empty">Loading quota...</div>
      )}
      <div className="settings-section-header" style={{ marginTop: 16 }}><h3>Session Token Stats</h3></div>
      <div className="settings-usage-grid">
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Input Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalInput)}</span>
        </div>
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Output Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalOutput)}</span>
        </div>
        <div className="settings-card settings-usage-card" style={{ gridColumn: '1 / -1' }}>
          <span className="settings-usage-label">Lifetime Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalLifetime)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────
export const SettingsView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('profile')
  return (
    <div className="settings-root">
      <div className="settings-title-bar" />
      <div className="settings-layout">
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {TABS.map(t => (
            <button key={t.id} className={`sidebar-footer-item ${tab === t.id ? 'settings-nav-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'permissions' && <PermissionsTab />}
          {tab === 'mcp' && <McpTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'usage' && <UsageTab />}
        </div>
      </div>
    </div>
  )
}
export default SettingsView
