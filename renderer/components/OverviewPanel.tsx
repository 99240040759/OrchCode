import React from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { Package, Coins, Loader } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { sessionTokensAtom, lifetimeTokensAtom, selectedModelAtom, availableModelsAtom } from '../store/agentStore'
import { getDisplayName, getArtifactIcon } from '../lib/uiUtils'
import type { ArtifactEntry } from '../../preload/index.d'

export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

export interface TokenIndicatorProps { current: number; max: number }

function ringColor(fraction: number): string {
  if (fraction >= 0.95) return '#ef4444'
  if (fraction >= 0.8) return '#f59e0b'
  if (fraction >= 0.5) return '#10b981'
  return '#5e5e5e'
}

const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export const TokenIndicator: React.FC<TokenIndicatorProps> = ({ current, max }) => {
  const fraction = Math.min(current / max, 1)
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction)
  const color = ringColor(fraction)
  const formattedTokens = formatTokens(current)
  return (
    <div className="token-ring-wrapper" title={`${current.toLocaleString()} / ${max.toLocaleString()} tokens\n${(fraction * 100).toFixed(1)}% context filled`}>
      <svg width={RING_RADIUS * 2 + 4} height={RING_RADIUS * 2 + 4} viewBox={`0 0 ${RING_RADIUS * 2 + 4} ${RING_RADIUS * 2 + 4}`} className="token-ring-svg">
        <circle cx={RING_RADIUS + 2} cy={RING_RADIUS + 2} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={2} />
        <circle cx={RING_RADIUS + 2} cy={RING_RADIUS + 2} r={RING_RADIUS} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={dashOffset} className="token-ring-circle" />
      </svg>
      {fraction > 0.05 && <span className="token-ring-label" style={{ color }}>{formattedTokens}</span>}
    </div>
  )
}

interface OverviewPanelProps {
  artifacts: ArtifactEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
}

const OverviewPanel: React.FC<OverviewPanelProps> = ({ artifacts, loading, handleArtifactClick }) => {
  const sessionTokens = useAtomValue(sessionTokensAtom)
  const lifetimeTokens = useAtomValue(lifetimeTokensAtom)
  const selectedModelId = useAtomValue(selectedModelAtom)
  const availableModels = useAtomValue(availableModelsAtom)
  const activeModel = availableModels[selectedModelId] || Object.values(availableModels).find(m => m.id === selectedModelId)
  const maxTokens = activeModel?.contextWindow || 200000
  const pct = Math.min(Math.round((sessionTokens / maxTokens) * 100), 100)
  const barColor = ringColor(sessionTokens / maxTokens)

  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div className="overview-container">
          <div className="overview-flex-container">
            <div className="panel-root overview-panel">
              <div className="panel-header">
                <div className="panel-header-left"><Coins size={14} color="var(--text-secondary)" /><span>Context Usage</span></div>
                <div className="panel-header-right" title="Tokens used in current active window session"><TokenIndicator current={sessionTokens} max={maxTokens} /></div>
              </div>
              <div className="panel-content overview-panel-content">
                <div className="overview-bar-bg">
                  <div className="overview-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <div className="overview-info-row">
                  <span className="overview-info-text">Active Context: {formatTokens(sessionTokens)} / {formatTokens(maxTokens)} ({pct}%)</span>
                  <span className="overview-info-text" title="Total tokens consumed across entire conversation history including compacted blocks">
                    Total Session: {formatTokens(lifetimeTokens)}
                  </span>
                </div>
                <div className="overview-compaction-note">
                  To maintain performance and keep response times fast, conversation history is automatically compacted when active usage approaches {formatTokens(Math.floor(maxTokens * 0.8))} tokens.
                </div>
              </div>
            </div>
            <div className="panel-root overview-panel">
              <div className="panel-header">
                <div className="panel-header-left"><Package size={14} color="var(--text-secondary)" /><span>Artifacts</span></div>
              </div>
              <div className="panel-content">
                {loading ? (
                  <div className="overview-loading-artifacts">
                    <Loader className="animate-spin" size={16} />
                    <span>Loading artifacts...</span>
                  </div>
                ) : artifacts.length === 0 ? <div className="empty-text">No artifacts created yet.</div>
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
