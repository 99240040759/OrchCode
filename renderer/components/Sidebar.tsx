import React, { useState } from 'react'
import {
  TbNavigation,
  TbSearch,
  TbFolderOpen,
  TbFolder,
  TbChevronRight,
  TbFolderPlus,
  TbTrash,
  TbLoader2,
  TbLogout,
  TbCircleCheck,
  TbX,
  TbPencil
} from 'react-icons/tb'
import { cn } from '../lib/utils'
import { useThreadStore } from '../lib/threadStore'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../lib/authStore'
import { toast } from '../lib/toast'
import { Button, IconButton, UiButton } from './button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from './dropdownMenu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './dialog'
import ms from 'ms'

function formatMiniTime(ts: number | string | Date | undefined): string {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (isNaN(diff) || diff < 10000) return 'now'
  if (diff >= 365 * 24 * 60 * 60 * 1000)
    return `${Math.floor(diff / (365 * 24 * 60 * 60 * 1000))}y ago`
  if (diff >= 30 * 24 * 60 * 60 * 1000)
    return `${Math.floor(diff / (30 * 24 * 60 * 60 * 1000))}mo ago`
  return `${ms(diff)} ago`
}

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <Button
      onClick={onClick}
      variant={active ? 'active' : 'default'}
      className={cn(
        'w-full justify-start gap-2.5 px-2.5 py-nav-y text-left text-sm',
        !active && 'text-tx-sub'
      )}
    >
      <span className={cn('flex-shrink-0', active ? 'text-tx-sub' : 'text-tx-dim')}>{icon}</span>
      <span>{label}</span>
    </Button>
  )
}

function SessionItem({
  session,
  active,
  streamLoading,
  onClick,
  onDelete,
  onRename
}: {
  session: {
    sessionId: string
    metadata?: { title?: string }
    createdAt?: number | string | Date
    startedAt?: number | string | Date
    workspaceRoot?: string
    cwd?: string
  }
  active: boolean
  streamLoading?: boolean
  onClick: () => void
  onDelete: () => void
  onRename: (sessionId: string, newTitle: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.metadata?.title || 'Untitled')
  const [menuOpen, setMenuOpen] = useState(false)
  const [triggerPos, setTriggerPos] = useState({ x: 0, y: 0 })
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const handleRename = (e: React.KeyboardEvent | React.FocusEvent): void => {
    if ('key' in e && e.key !== 'Enter') return
    e.preventDefault()
    setEditing(false)
    if (title.trim() && title !== session.metadata?.title) onRename(session.sessionId, title.trim())
    else setTitle(session.metadata?.title || 'Untitled')
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (editing) return
    e.preventDefault()
    setTriggerPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={!editing ? onClick : undefined}
        onKeyDown={
          !editing
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onClick()
                }
              }
            : undefined
        }
        onContextMenu={handleContextMenu}
        className={cn(
          'relative group flex items-center justify-between pl-2 pr-1 py-agent-y text-sm rounded-md transition-colors cursor-pointer border-none outline-none min-w-0 gap-2 focus-visible:ring-2 focus-visible:ring-tx-sub',
          active
            ? 'bg-oc-active text-tx-bright'
            : 'text-tx-muted hover:text-tx-main hover:bg-oc-hover'
        )}
      >
        <div className="flex items-center min-w-0 flex-1">
          {streamLoading ? (
            <TbLoader2
              size={15}
              className={cn(
                'animate-spin flex-shrink-0 mr-1.5',
                active ? 'text-tx-bright' : 'text-oc-active'
              )}
            />
          ) : (
            <TbCircleCheck
              size={15}
              className={cn('flex-shrink-0 mr-1.5', active ? 'text-tx-bright' : 'text-tx-dim')}
            />
          )}
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleRename}
              onBlur={handleRename}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-transparent outline-none text-tx-main text-sm p-0 m-0 border-none"
            />
          ) : (
            <span className="truncate">{session.metadata?.title || 'Untitled'}</span>
          )}
        </div>
        {!editing && (
          <div className="flex-shrink-0 flex items-center justify-end w-14 relative h-4">
            <span className="text-3xs text-tx-muted pointer-events-none select-none font-medium whitespace-nowrap">
              {formatMiniTime(session.createdAt || session.startedAt)}
            </span>
          </div>
        )}
      </div>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            style={{
              position: 'fixed',
              left: triggerPos.x,
              top: triggerPos.y,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-36">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <TbPencil className="mr-2 h-4 w-4" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setShowConfirmDelete(true)}>
            <TbTrash className="mr-2 h-4 w-4 text-destructive" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{session.metadata?.title || 'Untitled'}&quot;?
              This action is permanent and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <UiButton variant="outline" onClick={() => setShowConfirmDelete(false)}>
              Cancel
            </UiButton>
            <UiButton
              variant="destructive"
              onClick={() => {
                setShowConfirmDelete(false)
                onDelete()
              }}
            >
              Delete
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Sidebar(): React.JSX.Element {
  const {
    sessions,
    currentSessionId,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    openFolders,
    activeFolderPath,
    openFolderDialog,
    setActiveNav,
    activeNav,
    setActiveFolderPath,
    streamStates,
    workspaceRemoveFolder
  } = useThreadStore(
    useShallow((s) => ({
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      selectSession: s.selectSession,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      renameSession: s.renameSession,
      openFolders: s.openFolders,
      activeFolderPath: s.activeFolderPath,
      openFolderDialog: s.openFolderDialog,
      setActiveNav: s.setActiveNav,
      activeNav: s.activeNav,
      setActiveFolderPath: s.setActiveFolderPath,
      streamStates: s.streamStates,
      workspaceRemoveFolder: s.workspaceRemoveFolder
    }))
  )
  const { logout, user } = useAuthStore()
  const [homeExpanded, setHomeExpanded] = useState(true)
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>({})
  const [budget, setBudget] = useState<
    | { cost_usd: number; limit_usd: number; remaining: number; period: string; allowed: boolean }
    | undefined
  >(undefined)
  const [loadingBudget, setLoadingBudget] = useState(false)
  const [budgetFetched, setBudgetFetched] = useState(false)

  const fetchBudget = async (): Promise<void> => {
    if (loadingBudget || budgetFetched) return
    setLoadingBudget(true)
    try {
      const res = await window.api.budgetGet()
      if (res) setBudget(res)
      setBudgetFetched(true)
    } catch (err: unknown) {
      toast.error('Failed to retrieve budget limit information.', err)
      setBudgetFetched(false)
    } finally {
      setLoadingBudget(false)
    }
  }

  const handleLogout = async (): Promise<void> => {
    setBudget(undefined)
    setBudgetFetched(false)
    await logout()
  }

  const sortedSessions = [...sessions].sort(
    (a, b) =>
      new Date(b.startedAt ?? b.updatedAt ?? 0).getTime() -
      new Date(a.startedAt ?? a.updatedAt ?? 0).getTime()
  )

  const handleNewAgent = async (): Promise<void> => {
    setActiveNav(undefined)
    const existing = sessions.filter((s) => s.metadata?.title?.startsWith('Chat '))
    let max = 0
    existing.forEach((s) => {
      const num = parseInt(s.metadata?.title?.replace('Chat ', '') || '0', 10)
      if (!isNaN(num) && num > max) max = num
    })
    const idx = max + 1
    await createSession(`Chat ${idx}`, activeFolderPath || undefined)
  }

  const wsSessionsMap = (() => {
    const map = new Map<string, typeof sortedSessions>()
    const orphans: typeof sortedSessions = []
    for (const session of sortedSessions) {
      const root = session.workspaceRoot ? session.workspaceRoot.replace(/\\/g, '/').toLowerCase() : ''
      const matched = openFolders.find((f) => f.path.replace(/\\/g, '/').toLowerCase() === root)
      if (root && matched) {
        const p = matched.path
        if (!map.has(p)) map.set(p, [])
        map.get(p)?.push(session)
      } else {
        orphans.push(session)
      }
    }
    return { map, orphans }
  })()

  return (
    <div className="flex flex-col h-full w-sidebar flex-shrink-0">
      <div className="flex flex-col gap-nav-gap px-1 pt-2.5 pb-1.5">
        <NavItem
          icon={<TbNavigation size={18} strokeWidth={1.8} />}
          label="New Agent"
          active={activeNav === 'new'}
          onClick={handleNewAgent}
        />
        <NavItem
          icon={<TbSearch size={18} strokeWidth={1.8} />}
          label="Search"
          active={activeNav === 'Search'}
          onClick={() => setActiveNav('Search')}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1 pt-section-gap">
        <div className="flex items-center justify-between px-1.5 mb-1.5">
          <span className="text-2xs text-tx-muted font-bold tracking-wider uppercase">
            Repositories
          </span>
          <div className="flex items-center gap-0.5">
            {activeFolderPath && (
              <IconButton
                size="sm"
                onClick={() => {
                  workspaceRemoveFolder(activeFolderPath)
                  setActiveFolderPath(undefined)
                }}
                tooltip="Remove Active Workspace"
              >
                <TbX size={16} strokeWidth={2} className="text-tx-dim hover:text-destructive" />
              </IconButton>
            )}
            <IconButton size="sm" onClick={openFolderDialog} tooltip="Add Repository Folder">
              <TbFolderPlus size={16} strokeWidth={1.8} />
            </IconButton>
          </div>
        </div>
        <div className="flex flex-col gap-folder-gap">
          <div>
            <button
              onClick={() => {
                setActiveFolderPath(undefined)
                setHomeExpanded((e) => !e)
              }}
              className={cn(
                'flex items-center gap-1.5 w-full px-1.5 py-repo-y rounded-md text-sm font-medium text-left border-none outline-none cursor-pointer bg-transparent hover:bg-oc-hover transition-colors',
                !activeFolderPath ? 'text-tx-bright' : 'text-tx-muted hover:text-tx-main'
              )}
            >
              <TbChevronRight
                size={14}
                strokeWidth={2.5}
                className={cn(
                  'text-tx-dim flex-shrink-0 transition-transform duration-150',
                  homeExpanded && 'rotate-90'
                )}
              />
              {homeExpanded ? (
                <TbFolderOpen size={17} strokeWidth={1.8} className="text-tx-muted flex-shrink-0" />
              ) : (
                <TbFolder size={17} strokeWidth={1.8} className="text-tx-muted flex-shrink-0" />
              )}
              <span className="ml-0.5">Home</span>
            </button>
            {homeExpanded && (
              <div className="flex flex-col gap-folder-gap pl-5 pr-1">
                {wsSessionsMap.orphans.map((s) => (
                  <SessionItem
                    key={s.sessionId}
                    session={s}
                    active={s.sessionId === currentSessionId && !activeNav}
                    streamLoading={!!streamStates[s.sessionId]?.isLoading}
                    onClick={() => {
                      setActiveNav(undefined)
                      selectSession(s.sessionId)
                    }}
                    onDelete={() => deleteSession(s.sessionId)}
                    onRename={renameSession}
                  />
                ))}
                {wsSessionsMap.orphans.length === 0 && (
                  <p className="pl-2.5 py-repo-y text-2xs text-tx-dim italic">
                    No chats — click + to start
                  </p>
                )}
              </div>
            )}
          </div>
          {openFolders.map((folder) => {
            const isExp = !!wsExpanded[folder.path]
            return (
              <div key={folder.path} className="flex flex-col">
                <button
                  onClick={() => {
                    setActiveFolderPath(folder.path)
                    setHomeExpanded(false)
                    setWsExpanded((p) => ({ ...p, [folder.path]: !p[folder.path] }))
                  }}
                  className={cn(
                    'flex items-center gap-1.5 w-full px-1.5 py-repo-y rounded-md text-sm font-medium text-left border-none outline-none cursor-pointer bg-transparent hover:bg-oc-hover transition-colors min-w-0',
                    folder.path === activeFolderPath
                      ? 'text-tx-bright'
                      : 'text-tx-muted hover:text-tx-main'
                  )}
                >
                  <TbChevronRight
                    size={14}
                    strokeWidth={2.5}
                    className={cn(
                      'text-tx-dim flex-shrink-0 transition-transform duration-150',
                      isExp && 'rotate-90'
                    )}
                  />
                  {isExp ? (
                    <TbFolderOpen
                      size={17}
                      strokeWidth={1.8}
                      className="text-tx-muted flex-shrink-0"
                    />
                  ) : (
                    <TbFolder size={17} strokeWidth={1.8} className="text-tx-muted flex-shrink-0" />
                  )}
                  <span className="truncate ml-0.5">{folder.name}</span>
                </button>
                {isExp && (
                  <div className="flex flex-col gap-folder-gap pl-5 pr-1">
                    {wsSessionsMap.map.get(folder.path)?.map((s) => (
                      <SessionItem
                        key={s.sessionId}
                        session={s}
                        active={s.sessionId === currentSessionId && !activeNav}
                        streamLoading={!!streamStates[s.sessionId]?.isLoading}
                        onClick={() => {
                          setActiveNav(undefined)
                          selectSession(s.sessionId)
                        }}
                        onDelete={() => deleteSession(s.sessionId)}
                        onRename={renameSession}
                      />
                    ))}
                    {(wsSessionsMap.map.get(folder.path) ?? []).length === 0 && (
                      <p className="pl-2.5 py-repo-y text-2xs text-tx-dim italic">No chats yet</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="border-t border-oc-border px-1 py-1.5 flex flex-col">
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) fetchBudget()
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="flex items-center justify-between w-full px-1.5 py-nav-y hover:bg-oc-hover data-[state=open]:bg-oc-hover data-[state=open]:text-tx-bright rounded-md transition-colors border-none outline-none cursor-pointer bg-transparent text-left min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt="profile"
                    className="w-avatar h-avatar rounded-full border border-oc-border flex-shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-avatar h-avatar rounded-full bg-oc-active border border-oc-border flex items-center justify-center text-2xs font-bold text-tx-sub flex-shrink-0">
                    {user?.name?.[0]?.toUpperCase() ?? 'U'}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-tx-sub font-semibold leading-tight truncate">
                    {user?.name || 'User'}
                  </span>
                  <span className="text-2xs text-tx-dim leading-tight truncate">
                    {user?.email || 'Local Mode'}
                  </span>
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 mb-2" align="end" side="top">
            <DropdownMenuLabel>Usage Budget</DropdownMenuLabel>
            {loadingBudget ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-tx-muted">
                <TbLoader2 size={15} className="animate-spin" />
                <span>Fetching budget...</span>
              </div>
            ) : budget ? (
              <div className="flex flex-col gap-1.5 p-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-tx-sub">Cost (this month):</span>
                  <span className="font-mono font-semibold text-tx-bright">
                    ${budget.cost_usd.toFixed(4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tx-sub">Limit:</span>
                  <span className="font-mono font-semibold text-tx-bright">
                    ${budget.limit_usd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tx-sub">Remaining:</span>
                  <span
                    className={cn(
                      'font-mono font-semibold',
                      budget.remaining <= 0 ? 'text-destructive' : 'text-emerald-500'
                    )}
                  >
                    ${budget.remaining.toFixed(4)}
                  </span>
                </div>
                <div className="flex justify-between text-3xs text-tx-muted mt-1 border-t border-oc-border pt-1">
                  <span>Period: {budget.period}</span>
                  <span>{budget.allowed ? 'Active' : 'Limit Reached'}</span>
                </div>
              </div>
            ) : (
              <div className="px-2 py-3 text-xs text-tx-muted italic">
                Budget information unavailable
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} variant="destructive">
              <TbLogout size={16} className="mr-2" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
