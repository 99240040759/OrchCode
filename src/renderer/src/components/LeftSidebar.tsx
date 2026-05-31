import React, { useState, useRef } from 'react'
import { useDrag } from '@use-gesture/react'
import {
  Inbox,
  PanelLeftClose,
  PanelLeft,
  Plus,
  BookOpen,
  Settings,
  Lightbulb,
  Globe
} from 'lucide-react'

interface SidebarProps {
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
  onStartConversation?: () => void
  onFooterItemClick?: (item: 'knowledge' | 'browser' | 'settings' | 'feedback') => void
  threadListContent?: React.ReactNode
}

const MIN_WIDTH = 220
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 280

export const LeftSidebar: React.FC<SidebarProps> = ({
  expanded: controlledExpanded,
  onToggle,
  onStartConversation,
  onFooterItemClick,
  threadListContent
}) => {
  const [localExpanded, setLocalExpanded] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded
  const dragRef = useRef<HTMLDivElement>(null)

  const handleToggle = () => {
    const newExpanded = !isExpanded
    if (controlledExpanded === undefined) {
      setLocalExpanded(newExpanded)
    }
    onToggle?.(newExpanded)
  }

  const bindDragWithCommit = useDrag(
    ({ movement: [mx], first, last, memo }) => {
      if (first) memo = sidebarWidth
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (memo ?? DEFAULT_WIDTH) + mx))
      if (dragRef.current?.parentElement) {
        dragRef.current.parentElement.style.width = `${newWidth}px`
      }
      if (last) {
        setSidebarWidth(newWidth)
        requestAnimationFrame(() => {
          if (dragRef.current?.parentElement) {
            dragRef.current.parentElement.style.width = ''
          }
        })
      }
      return memo
    },
    { axis: 'x', filterTaps: true, from: () => [0, 0] }
  )

  if (isExpanded) {
    return (
      <aside className="sidebar expanded" style={{ width: sidebarWidth, position: 'relative' }}>
        <div
          ref={dragRef}
          {...bindDragWithCommit()}
          style={{
            position: 'absolute',
            right: -2,
            top: 0,
            bottom: 0,
            width: 5,
            cursor: 'col-resize',
            zIndex: 10,
            touchAction: 'none'
          }}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_WIDTH)
            if (dragRef.current?.parentElement) {
              dragRef.current.parentElement.style.width = ''
            }
          }}
        />

        <div className="sidebar-top-section" style={{ padding: '12px 12px', gap: 12 }}>
          <div className="sidebar-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '32px' }}>
            <div className="inbox-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-lg)', fontWeight: 500 }}>
              <Inbox size={18} strokeWidth={1.5} color="var(--text-secondary)" />
              <span style={{ color: '#e5e5e5' }}>Inbox</span>
            </div>
            <div className="sidebar-collapse-btn" onClick={handleToggle} title="Collapse Sidebar" style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}>
              <PanelLeftClose size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            </div>
          </div>

          <div className="sidebar-start-conv" onClick={onStartConversation}>
            <Plus size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <span>Start conversation</span>
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-body">
          {threadListContent && (
            <>
              {threadListContent}
              <div className="sidebar-divider" />
            </>
          )}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-footer">
          <div className="sidebar-footer-item" onClick={() => onFooterItemClick?.('knowledge')}>
            <BookOpen size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <span>Knowledge</span>
          </div>
          <div className="sidebar-footer-item" onClick={() => onFooterItemClick?.('browser')}>
            <Globe size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <span>Browser</span>
          </div>
          <div className="sidebar-footer-item" onClick={() => onFooterItemClick?.('settings')}>
            <Settings size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <span>Settings</span>
          </div>
          <div className="sidebar-footer-item" onClick={() => onFooterItemClick?.('feedback')}>
            <Lightbulb size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <span>Provide Feedback</span>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="sidebar collapsed">
      <div className="collapsed-sidebar-top" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div className="collapsed-icon-wrapper" onClick={handleToggle} title="Expand Sidebar" style={{ padding: '14px 0', display: 'flex', justifyContent: 'center' }}>
          <PanelLeft size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
        <div className="sidebar-divider" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0', alignItems: 'center' }}>
          <div className="collapsed-icon-wrapper" title="Inbox" style={{ padding: 0 }}>
            <Inbox size={18} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
          <div className="collapsed-icon-wrapper" onClick={onStartConversation} title="Start Conversation" style={{ padding: 0 }}>
            <Plus size={18} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        </div>
        <div className="sidebar-divider" />
      </div>

      <div className="sidebar-footer" style={{ borderTop: 'none', alignItems: 'center', gap: 20, paddingBottom: 16, paddingTop: 16, width: '100%' }}>
        <div className="collapsed-icon-wrapper" onClick={() => onFooterItemClick?.('knowledge')} title="Knowledge" style={{ padding: 0 }}>
          <BookOpen size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
        <div className="collapsed-icon-wrapper" onClick={() => onFooterItemClick?.('browser')} title="Browser" style={{ padding: 0 }}>
          <Globe size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
        <div className="collapsed-icon-wrapper" onClick={() => onFooterItemClick?.('settings')} title="Settings" style={{ padding: 0 }}>
          <Settings size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
        <div className="collapsed-icon-wrapper" onClick={() => onFooterItemClick?.('feedback')} title="Provide Feedback" style={{ padding: 0 }}>
          <Lightbulb size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
      </div>
    </aside>
  )
}
export default LeftSidebar
