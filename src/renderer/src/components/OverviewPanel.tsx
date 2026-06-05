import React from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import Skeleton from 'react-loading-skeleton'
import { Info, Package } from 'lucide-react'
import { getDisplayName, getArtifactIcon } from '../lib/uiUtils'
import type { ArtifactEntry } from '../../../preload/index.d'
import { Panel } from './Primitives'

interface OverviewPanelProps {
  artifacts: ArtifactEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
}

const OverviewPanel: React.FC<OverviewPanelProps> = ({ artifacts, loading, handleArtifactClick }) => {
  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div className="overview-container">
          <div className="overview-header">
            <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <h2 className="overview-title">Session Overview</h2>
          </div>
          <div className="overview-grid">
            <Panel className="overview-panel">
              <div className="panel-header">
                <div className="panel-header-left"><Package size={14} style={{ color: 'var(--text-secondary)' }} /><span>Artifacts</span></div>
              </div>
              <div className="panel-content">
                {loading ? <Skeleton count={3} height={28} baseColor="#262626" highlightColor="#333333" style={{ marginBottom: 6, borderRadius: 4 }} />
                  : artifacts.length === 0 ? <div className="empty-text">No artifacts created yet.</div>
                  : artifacts.map((art) => (
                    <div key={art.name} onClick={() => handleArtifactClick(art)} className="overview-item">
                      {getArtifactIcon(art.name, 15)}
                      <span className="item-text">{getDisplayName(art.name)}</span>
                    </div>
                  ))}
              </div>
            </Panel>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="ScrollAreaScrollbar" orientation="vertical">
        <ScrollArea.Thumb className="ScrollAreaThumb" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner className="ScrollAreaCorner" />
    </ScrollArea.Root>
  )
}
export default OverviewPanel
