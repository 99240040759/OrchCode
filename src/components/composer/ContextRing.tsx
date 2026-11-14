import { memo } from "react";
import { AUTO_COMPACT_RATIO, formatTokens, formatWindow } from "../../lib/utils";
import { Tooltip } from "../ui/Tooltip";

const RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ContextRingProps {
  contextWindow?: number;
  usage: { contextTokens: number; cachedTokens?: number; inputTokens?: number };
}

export const ContextRing = memo(function ContextRing({ contextWindow, usage }: ContextRingProps) {
  const max = contextWindow || 262144;
  const { contextTokens, cachedTokens, inputTokens } = usage;
  const pct = Math.min(100, Math.max(0, Math.round((contextTokens / max) * 100)));
  const compactAt = Math.round(max * AUTO_COMPACT_RATIO);
  const level = contextTokens >= compactAt || pct > 85 ? "danger" : contextTokens >= compactAt * 0.8 ? "warn" : undefined;
  const cacheHit = inputTokens && cachedTokens !== undefined ? Math.round((cachedTokens / inputTokens) * 100) : null;
  const tip =
    `Context: ${formatTokens(contextTokens)} of ${formatWindow(max)} tokens (${pct}%)` +
    (cacheHit !== null ? ` · Cache hit ${cacheHit}%` : "");

  return (
    <Tooltip content={tip}>
      <span className="ring" data-level={level}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle className="ring-track" cx="8" cy="8" r={RADIUS} />
          <circle
            className="ring-fill"
            cx="8"
            cy="8"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
          />
        </svg>
      </span>
    </Tooltip>
  );
});
