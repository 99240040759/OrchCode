import React, { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAtomValue } from 'jotai'
import { PanelLeftClose, Plus } from 'lucide-react'

import { authUserAtom } from '../store/agentStore'
import { GoogleIcon } from '../lib/uiUtils'
import { authService } from '../services/authService'
import * as styles from './Sidebar.css'
import * as titlebarStyles from '../assets/titlebar.css'

interface SidebarProps {
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
  onStartConversation?: () => void
  threadListContent?: React.ReactNode
}

const isMac = window.updaterBridge.platform === 'darwin'

const LeftSidebar: React.FC<SidebarProps> = ({
  expanded: controlledExpanded,
  onToggle,
  onStartConversation,
  threadListContent
}) => {
  const [localExpanded, setLocalExpanded] = useState(true)
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded

  const authUser = useAtomValue(authUserAtom)

  const handleLogin = async () => {
    try {
      await authService.startGoogleAuth()
    } catch (err) {
      console.error('Google Sign-in failed:', err)
    }
  }

  const handleLogout = async () => {
    try {
      await authService.logout()
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
    <aside className={`${styles.sidebarRoot} ${styles.sidebarExpanded}`}>
      <div className={styles.sidebarInner}>
        {/* Drag region + collapse button */}
        <div
          className={`${styles.sidebarHeaderRow} app-region-drag ${isMac ? styles.sidebarHeaderRowMac : styles.sidebarHeaderRowWin}`}
        >
          <div
            className={`${styles.sidebarCollapseBtn} app-region-no-drag`}
            onClick={handleToggle}
            title="Collapse Sidebar"
          >
            <PanelLeftClose size={16} strokeWidth={1.5} className="text-secondary" />
          </div>
        </div>

        {/* New Conversation button */}
        <div className={styles.sidebarTopSection}>
          <div className={styles.sidebarStartConv} onClick={onStartConversation}>
            <Plus size={16} strokeWidth={2} className="text-secondary" />
            <span>New Conversation</span>
          </div>
        </div>

        <div className={styles.sidebarDividerContainer}>
          <div className={styles.sidebarDivider} />
        </div>

        {/* Thread list */}
        <div className={styles.sidebarBody}>{threadListContent}</div>

        <div className={styles.sidebarDividerContainer}>
          <div className={styles.sidebarDivider} />
        </div>

        {/* User profile / sign-in */}
        <div className={`${styles.sidebarFooter} app-region-no-drag`}>
          {authUser ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className={styles.sidebarFooterItem}>
                  {authUser.photoUrl ? (
                    <img
                      src={authUser.photoUrl}
                      alt={authUser.name}
                      className={titlebarStyles.profileAvatarImg}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className={titlebarStyles.profileAvatarFallback}>
                      {authUser.name
                        ? authUser.name.charAt(0).toUpperCase()
                        : authUser.email.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-ellipsis flex-1">{authUser.name || authUser.email}</span>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content asChild align="start" side="right" sideOffset={12}>
                  <div
                    className={`${titlebarStyles.profileDropdown} ${titlebarStyles.nativeDropdownContent}`}
                  >
                    <div className={titlebarStyles.profileInfo}>
                      <div className={titlebarStyles.profileName}>
                        {authUser.name || 'Google User'}
                      </div>
                      <div className={titlebarStyles.profileEmail}>{authUser.email}</div>
                    </div>
                    <DropdownMenu.Separator className={titlebarStyles.profileSeparator} />
                    <DropdownMenu.Item
                      className={`${titlebarStyles.profileItem} ${titlebarStyles.profileItemLogout}`}
                      onSelect={handleLogout}
                    >
                      Log Out
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button
              className={`${styles.sidebarFooterItem} ${styles.googleBtn}`}
              onClick={handleLogin}
            >
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
