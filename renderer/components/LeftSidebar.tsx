import React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAtomValue } from 'jotai'
import { Plus } from 'lucide-react'
import { authUserAtom } from '../store/agentStore'
import { GoogleIcon } from '../lib/uiUtils'
import { authService } from '../services/services'

// LeftSidebar is a controlled component (App.tsx passes expanded prop).
interface SidebarProps {
  expanded: boolean
  onStartConversation?: () => void
  threadListContent?: React.ReactNode
}
import { isMac } from '../lib/sharedUtils'

const LeftSidebar: React.FC<SidebarProps> = ({ expanded, onStartConversation, threadListContent }) => {
  const authUser = useAtomValue(authUserAtom)

  const handleLogin = async () => { try { await authService.startGoogleAuth() } catch (err) { console.error('Google Sign-in failed:', err) } }
  const handleLogout = async () => { try { await authService.logout() } catch (err) { console.error('Logout failed:', err) } }

  return (
    <aside className={`sidebar-root ${expanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <div className="sidebar-inner">
        <div className={`sidebar-header-row app-region-drag ${isMac ? 'sidebar-header-row-mac' : 'sidebar-header-row-win'}`}>
        </div>

        <div className="sidebar-top-section">
          <div className="sidebar-start-conv" onClick={onStartConversation}>
            <Plus size={16} strokeWidth={2} className="text-secondary" />
            <span>New Conversation</span>
          </div>
        </div>

        <div className="sidebar-divider-container"><div className="sidebar-divider" /></div>

        <div className="sidebar-body">{threadListContent}</div>

        <div className="sidebar-divider-container"><div className="sidebar-divider" /></div>

        <div className="sidebar-footer app-region-no-drag">
          {authUser ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="sidebar-footer-item">
                  {authUser.photoUrl ? (
                    <img src={authUser.photoUrl} alt={authUser.name} className="profile-avatar-img" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="profile-avatar-fallback">
                      {authUser.name ? authUser.name.charAt(0).toUpperCase() : authUser.email.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-ellipsis flex-1">{authUser.name || authUser.email}</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content asChild align="start" side="right" sideOffset={12}>
                  <div className="app-dropdown-panel">
                    <div className="profile-info">
                      <div className="profile-name">{authUser.name || 'Google User'}</div>
                      <div className="profile-email">{authUser.email}</div>
                    </div>
                    <DropdownMenu.Separator className="profile-separator" />
                    <DropdownMenu.Item className="app-dropdown-item profile-item-logout" onSelect={handleLogout}>Log Out</DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button className="sidebar-footer-item google-btn" onClick={handleLogin}>
              <GoogleIcon size={14} />
              <span className="text-ellipsis">Sign In</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

export default LeftSidebar
