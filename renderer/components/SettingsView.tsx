import React, { useState, useEffect, useCallback } from 'react'
import { User, Shield, BarChart3, RefreshCw, Plus, Trash2, Brain, ChevronDown, Check } from 'lucide-react'
import Dropdown, { DropdownItem } from './Dropdown'
import Tooltip from './Tooltip'
import { permissionService, memoryService, usageService, quotaService, authService } from '../services/services'
import type { UserProfile } from '../../preload/index.d'

type Tab = 'profile' | 'permissions' | 'memory' | 'usage'
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={15} /> },
  { id: 'permissions', label: 'Permissions', icon: <Shield size={15} /> },
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
const toolCategory = (t: string) => TOOL_FRIENDLY[t]?.category || 'Other'
const PERM_LABELS: Record<string, string> = { always_allow: 'Always Allow', always_ask: 'Always Ask', always_deny: 'Always Deny' }

// â”€â”€â”€ Permission Dropdown (Radix) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Permissions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PermissionsTab: React.FC = () => {
  const [perms, setPerms] = useState<Record<string, string>>({})
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const [all, def] = await Promise.all([permissionService.getAll(), permissionService.getDefaults()])
    setPerms(all); setDefaults(def)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => window.api.on('permissions:changed', () => { load() }), [load])
  const handleChange = async (tool: string, perm: string) => { await permissionService.set(tool, perm); setPerms(p => ({ ...p, [tool]: perm })) }
  const handleReset = async () => { await permissionService.reset(); await load() }
  const allTools = Object.keys({ ...perms, ...defaults }).sort()
  const grouped: Record<string, string[]> = {}
  allTools.forEach(t => { const cat = toolCategory(t); (grouped[cat] ??= []).push(t) })
  const catOrder = ['File System', 'Shell', 'Web', 'Media', 'Browser', 'Memory', 'Other']
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

// â”€â”€â”€ Memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Usage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const UsageTab: React.FC = () => {
  const [stats, setStats] = useState<{totalContext: number; totalLifetime: number} | null>(null)
  const [quota, setQuota] = useState<{allowed: boolean; remaining: number; cost_usd: number; limit_usd: number; period: string} | null>(null)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [s, q] = await Promise.allSettled([
        usageService.getTotals(),
        quotaService.get()
      ])
      if (s.status === 'fulfilled') setStats(s.value as any)
      if (q.status === 'fulfilled') { setQuota(q.value as any); setQuotaError(null) }
      else setQuotaError((q as any).reason?.message || 'Failed to load quota')
    } finally { if (showSpinner) setRefreshing(false) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  if (!stats) return <div className="settings-empty">Loading...</div>
  const fmt = (n: number) => n.toLocaleString()
  const fmtC = (n: number) => `$${n.toFixed(4)}`
  const pct = quota ? Math.min(100, (quota.cost_usd / Math.max(quota.limit_usd, 0.01)) * 100) : 0
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>Server Quota</h3>
        <Tooltip content="Refresh now">
          <button className="settings-action-btn" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={13} style={{ animation: refreshing ? 'orch-spin 0.8s linear infinite' : 'none' }} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </Tooltip>
      </div>
      {quotaError ? (
        <div className="settings-card" style={{ color: 'var(--text-muted)' }}>{quotaError}</div>
      ) : quota ? (
        <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Budget Period: <strong style={{ color: 'var(--text-primary)' }}>{quota.period}</strong></span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: quota.allowed ? 'var(--accent-green)' : 'var(--accent-red, #f44)' }}>{quota.allowed ? 'â— Active' : 'â— Exhausted'}</span>
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
          <span className="settings-usage-label">Active Context</span>
          <span className="settings-usage-value">{fmt(stats.totalContext)}</span>
        </div>
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Lifetime Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalLifetime)}</span>
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          {tab === 'memory' && <MemoryTab />}
          {tab === 'usage' && <UsageTab />}
        </div>
      </div>
    </div>
  )
}
export default SettingsView
