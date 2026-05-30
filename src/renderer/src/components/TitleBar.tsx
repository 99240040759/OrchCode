import React from 'react'
import { Settings } from 'lucide-react'

interface TitleBarProps {
  title?: string
  workspaceName?: string
  onOpenEditor?: () => void
  onSettingsClick?: () => void
}

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Orch Code',
  workspaceName,
  onOpenEditor,
  onSettingsClick
}) => {
  return (
    <header className="titlebar">
      <div className="titlebar-left" style={{ WebkitAppRegion: 'drag' } as any} />

      <div className="titlebar-center">
        {workspaceName ? workspaceName : title}
      </div>

      <div className="titlebar-right" style={{ paddingRight: isMac ? 8 : 140, display: 'flex', alignItems: 'center' }}>
        <div className="titlebar-action" onClick={onOpenEditor} style={{ fontSize: 13, fontWeight: 500, padding: '4px 8px' }}>
          <span>Open Editor</span>
        </div>
        
        <Settings size={15} strokeWidth={1.5} className="settings-btn" onClick={onSettingsClick} />
      </div>
    </header>
  )
}

export default TitleBar
