import React from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import Skeleton from 'react-loading-skeleton'
import { Info, Package, Coins } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { sessionTokensAtom } from '../store/agentStore'
import { getDisplayName, getArtifactIcon } from '../lib/uiUtils'
import type { ArtifactEntry } from '../../preload/index.d'

const MAX_TOKENS = 200_000

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface OverviewPanelProps {
  artifacts: ArtifactEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
}

const OverviewPanel: React.FC<OverviewPanelProps> = ({ artifacts, loading, handleArtifactClick }) => {
  const sessionTokens = useAtomValue(sessionTokensAtom)
  const pct = Math.min(100, Math.round((sessionTokens / MAX_TOKENS) * 100))
  const barColor = pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-orange)' : 'var(--accent-purple)'

  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div className="overview-container">
          <div className="overview-header">
            <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <h2 className="overview-title">Session Overview</h2>
          </div>
          <div className="overview-grid">
            <div className="panel-root overview-panel">
              <div className="panel-header">
                <div className="panel-header-left"><Coins size={14} color="var(--text-secondary)" /><span>Token Budget</span></div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTokens(sessionTokens)} / {formatTokens(MAX_TOKENS)}</span>
              </div>
              <div className="panel-content" style={{ paddingTop: 6, paddingBottom: 4 }}>
                <div style={{ height: 6, background: 'var(--bg-sidebar)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'block' }}>{pct}% used</span>
              </div>
            </div>
            <div className="panel-root overview-panel">
              <div className="panel-header">
                <div className="panel-header-left"><Package size={14} color="var(--text-secondary)" /><span>Artifacts</span></div>
              </div>
              <div className="panel-content">
                {loading ? <Skeleton count={3} height={28} baseColor="var(--bg-sidebar)" highlightColor="var(--border-color)" className="skeleton-item" />
                  : artifacts.length === 0 ? <div className="empty-text">No artifacts created yet.</div>
                  : artifacts.map((art) => (
                    <div key={art.name} onClick={() => handleArtifactClick(art)} className="overview-item">
                      {getArtifactIcon(art.name, 15)}
                      <span className="item-text">{getDisplayName(art.name)}</span>
                    </div>
                  ))}
              </div>
            </div>
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
