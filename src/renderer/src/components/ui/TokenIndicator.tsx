import React from 'react'

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
  const formattedTokens = current >= 1000 ? `${(current / 1000).toFixed(1)}k` : String(current)
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
