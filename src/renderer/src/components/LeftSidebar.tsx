import React, { useState, useEffect } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAtom } from 'jotai'
import { FolderPlus, Trash2, Plus, MessageSquare, ChevronDown, ChevronRight, LogOut, ExternalLink, Moon, PanelLeftClose } from 'lucide-react'
import './Sidebar.css'
import { authUserAtom } from '../store/agentStore'
import { GoogleIcon } from '../lib/uiUtils'

interface SidebarProps {
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
  onStartConversation?: () => void
  threadListContent?: React.ReactNode
}

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const LeftSidebar: React.FC<SidebarProps> = ({
  expanded: controlledExpanded,
  onToggle,
  onStartConversation,
  threadListContent
}) => {
  const [localExpanded, setLocalExpanded] = useState(true)
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded

  const [authUser, setAuthUser] = useAtom(authUserAtom)

  useEffect(() => {
    window.api.getAuthUser().then((user) => {
      setAuthUser(user)
    })

    const unsubscribeAuth = window.api.onAuthStatusChanged((user) => {
      setAuthUser(user)
    })

    return () => { unsubscribeAuth() }
  }, [setAuthUser])

  const handleLogin = async () => {
    try {
      await window.api.startGoogleAuth()
    } catch (err) {
      console.error('Google Sign-in failed:', err)
    }
  }

  const handleLogout = async () => {
    try {
      await window.api.logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleToggle = () => {
    const newExpanded = !isExpanded
    if (controlledExpanded === undefined) {
      setLocalExpanded(newExpanded)
    }
    onToggle?.(newExpanded)
  }

  if (!isExpanded) return null

  return (
    <aside
      className="sidebar expanded"
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '250px',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg-sidebar)',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        {/* Header Row */}
        <div
          className="sidebar-header-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '38px',
            paddingLeft: isMac ? '80px' : '12px',
            paddingRight: '12px',
            marginTop: 0,
            gap: '14px',
            flexShrink: 0,
            WebkitAppRegion: 'drag'
          } as any}
        >
          <div
            className="sidebar-collapse-btn"
            onClick={handleToggle}
            title="Collapse Sidebar"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <PanelLeftClose size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        </div>

        {/* Top Actions */}
        <div className="sidebar-top-section" style={{ padding: '8px 12px', gap: '4px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div
            className="sidebar-start-conv"
            onClick={onStartConversation}
          >
            <Plus size={16} strokeWidth={2} color="var(--text-secondary)" />
            <span>New Conversation</span>
          </div>
        </div>

        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          <div className="sidebar-divider" />
        </div>

        {/* Sidebar projects/threads */}
        <div className="sidebar-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {threadListContent}
        </div>

        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          <div className="sidebar-divider" />
        </div>

        {/* Footer Profile Dropdown / Sign-In Button */}
        <div className="sidebar-footer" style={{ padding: '8px 12px', flexShrink: 0, WebkitAppRegion: 'no-drag' } as any}>
          {authUser ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="sidebar-footer-item">
                  {authUser.photoUrl ? (
                    <img src={authUser.photoUrl} alt={authUser.name} style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} referrerPolicy="no-referrer" />
                  ) : (
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, backgroundColor: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {authUser.name ? authUser.name.charAt(0).toUpperCase() : authUser.email.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {authUser.name || authUser.email}
                  </span>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content asChild align="start" side="right" sideOffset={12}>
                  <div
                    className="titlebar-profile-dropdown native-dropdown-content"
                    style={{ transformOrigin: 'bottom left' }}
                  >
                    <div className="profile-dropdown-info">
                      <div className="profile-name">{authUser.name || 'Google User'}</div>
                      <div className="profile-email">{authUser.email}</div>
                    </div>
                    <DropdownMenu.Separator className="profile-dropdown-separator" />
                    <DropdownMenu.Item className="profile-dropdown-item logout" onSelect={handleLogout}>
                      Log Out
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button
              className="sidebar-footer-item google-btn"
              onClick={handleLogin}
            >
              <GoogleIcon size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

export default LeftSidebar
