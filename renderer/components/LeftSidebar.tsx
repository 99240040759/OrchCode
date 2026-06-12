import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useAtomValue } from 'jotai'
import Dropdown, { DropdownItem, DropdownSeparator } from './Dropdown'
import { Plus } from 'lucide-react'
import { authUserAtom, sidebarExpandedAtom } from '../store/agentStore'
import { GoogleIcon } from '../lib/uiUtils'
import { authService } from '../services/services'
import ThreadList from './ThreadList'
import { useChat } from '../hooks/useChat'
import Tooltip from './Tooltip'

const LeftSidebar: React.FC = () => {
  const authUser = useAtomValue(authUserAtom)
  const expanded = useAtomValue(sidebarExpandedAtom)
  const { newConversation, openWorkspace } = useChat()
  useHotkeys('ctrl+n, cmd+n', (e) => { e.preventDefault(); newConversation().catch(console.error) }, { enableOnFormTags: true })
  useHotkeys('ctrl+o, cmd+o', (e) => { e.preventDefault(); openWorkspace().catch(console.error) }, { enableOnFormTags: true })
  const handleLogin = async () => { try { await authService.startGoogleAuth() } catch (e) { console.error(e) } }
  const handleLogout = async () => { try { await authService.logout() } catch (e) { console.error(e) } }

  return (
    <aside className={`sidebar-root ${expanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <div className="sidebar-inner">

        <div className="sidebar-top-section">
          <Tooltip content="New Conversation (Ctrl+N)" side="right"><button type="button" className="sidebar-start-conv" onClick={() => newConversation()}><Plus size={16} strokeWidth={2} className="text-secondary" /><span>New Conversation</span></button></Tooltip>
        </div>

        <div className="sidebar-body"><ThreadList /></div>

        <div className="sidebar-footer app-region-no-drag">
          {authUser ? (
            <Dropdown
              align="start"
              side="right"
              sideOffset={12}
              trigger={
                <button className="sidebar-footer-item">
                  {authUser.photoUrl ? (
                    <img src={authUser.photoUrl} alt={authUser.name} className="profile-avatar-img" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="profile-avatar-fallback">
                      {authUser.name ? authUser.name.charAt(0).toUpperCase() : authUser.email.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-ellipsis flex-1 sidebar-username">{authUser.name || authUser.email}</span>
                </button>
              }
            >
              <div className="profile-info">
                <div className="profile-name">{authUser.name || 'Google User'}</div>
                <div className="profile-email">{authUser.email}</div>
              </div>
              <DropdownSeparator className="profile-separator" />
              <DropdownItem className="app-dropdown-item profile-item-logout" onSelect={handleLogout}>Log Out</DropdownItem>
            </Dropdown>
          ) : (
            <Tooltip content="Sign In (Ctrl+O)" side="right"><button className="sidebar-footer-item google-btn" onClick={handleLogin}><GoogleIcon size={14} /><span className="text-ellipsis">Sign In</span></button></Tooltip>
          )}
        </div>
      </div>
    </aside>
  )
}

export default LeftSidebar
