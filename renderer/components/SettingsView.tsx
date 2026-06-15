import React, { useState, useEffect, useCallback } from 'react'
import { User, BarChart3, RefreshCw, Plus, Trash2, Brain, ChevronDown } from 'lucide-react'
import Dropdown, { DropdownItem } from './Dropdown'
import Tooltip from './Tooltip'
import { memoryService, usageService, quotaService, authService } from '../services/services'
import type { UserProfile } from '../../preload/index.d'

type Tab = 'profile' | 'memory' | 'usage'
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={15} /> },
  { id: 'memory', label: 'Memory', icon: <Brain size={15} /> },
  { id: 'usage', label: 'Usage & Cost', icon: <BarChart3 size={15} /> },
]


const ProfileTab: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null)
  useEffect(() => { authService.getAuthUser().then(u => setUser(u)) }, [])
  if (!user) return <div className="settings-empty">Not signed in</div>
  return (
    <div className="settings-section">
      <div className="settings-card">
        {user.photoUrl
          ? <img src={user.photoUrl} className="profile-avatar-img" style={{ width: 48, height: 48 }} referrerPolicy="no-referrer" />
          : <div className="profile-avatar-fallback" style={{ width: 48, height: 48, fontSize: 18 }}>{user.name?.charAt(0) || user.email.charAt(0)}</div>}
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


const UsageTab: React.FC = () => {
  const [stats, setStats] = useState<{ totalInput: number; totalOutput: number; totalLifetime: number } | null>(null)
  const [quota, setQuota] = useState<{ allowed: boolean; remaining: number; cost_usd: number; limit_usd: number; period: string } | null>(null)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [s, q] = await Promise.allSettled([usageService.getTotals(), quotaService.get()])
      if (s.status === 'fulfilled') setStats(s.value as any)
      if (q.status === 'fulfilled') { setQuota(q.value as any); setQuotaError(null) }
      else setQuotaError((q as any).reason?.message || 'Failed to load quota')
    } finally { if (showSpinner) setRefreshing(false) }
  }, [])

  useEffect(() => { load(); const id = setInterval(() => load(), 30_000); return () => clearInterval(id) }, [load])

  if (!stats) return <div className="settings-empty">Loading...</div>
  const fmt = (n: number) => (n || 0).toLocaleString()
  const fmtC = (n: number) => `$${parseFloat(n.toFixed(2))}`
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
        <div className="settings-card" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{quotaError}</div>
      ) : quota ? (
        <div className="quota-card">
          <div className="quota-card-header">
            <div className="quota-period">
              <span className="quota-period-label">Budget Period</span>
              <span className="quota-period-value">{(() => { const [y, m] = quota.period.split('-'); return (m && y) ? new Date(+y, +m - 1).toLocaleString('default', { month: 'long', year: 'numeric' }) : quota.period })()}</span>
            </div>
            <span className={`quota-status-badge${quota.allowed ? '' : ' quota-status-exhausted'}`}>● {quota.allowed ? 'Active' : 'Exhausted'}</span>
          </div>
          <div className="quota-bar-row">
            <div className="quota-bar-track">
              <div className="quota-bar-fill" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--accent-red,#f44)' : pct > 70 ? '#d4a04a' : 'var(--accent-green,#4ade80)' }} />
            </div>
            <span className="quota-bar-pct">{Math.round(pct)}%</span>
          </div>
          <div className="quota-stats-row">
            <div className="quota-stat"><span className="quota-stat-label">Used</span><span className="quota-stat-value">{fmtC(quota.cost_usd)}</span></div>
            <div className="quota-stat"><span className="quota-stat-label">Limit</span><span className="quota-stat-value">{fmtC(quota.limit_usd)}</span></div>
            <div className="quota-stat"><span className="quota-stat-label">Remaining</span><span className="quota-stat-value" style={{ color: quota.remaining < quota.limit_usd * 0.1 ? 'var(--accent-red,#f44)' : 'var(--accent-green,#4ade80)' }}>{fmtC(quota.remaining)}</span></div>
          </div>
        </div>
      ) : (
        <div className="settings-empty">Loading quota...</div>
      )}
      <div className="settings-section-header" style={{ marginTop: 16 }}><h3>Token Usage</h3></div>
      <div className="settings-usage-grid">
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Input Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalInput)}</span>
        </div>
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Output Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalOutput)}</span>
        </div>
        <div className="settings-card settings-usage-card">
          <span className="settings-usage-label">Total Tokens</span>
          <span className="settings-usage-value">{fmt(stats.totalLifetime)}</span>
        </div>
      </div>
    </div>
  )
}


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
          {tab === 'memory' && <MemoryTab />}
          {tab === 'usage' && <UsageTab />}
        </div>
      </div>
    </div>
  )
}
export default SettingsView
