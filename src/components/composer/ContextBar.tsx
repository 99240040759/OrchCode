import React from "react";
import * as utils from "../../lib/utils";
import { Tooltip } from "../ui/Tooltip";

interface ContextBarProps {
  contextWindow?: number;
  sessionTokens: {
    contextTokens: number;
    cachedTokens?: number;
    inputTokens?: number;
  };
}

export const ContextBar = React.memo(function ContextBar({ contextWindow, sessionTokens }: ContextBarProps) {
  const maxContext = contextWindow || 262144;
  const { contextTokens, cachedTokens, inputTokens } = sessionTokens;
  const fillPct = Math.min(
    100,
    Math.max(0, Math.round((contextTokens / maxContext) * 100))
  );

  const compactAt = Math.round(maxContext * utils.AUTO_COMPACT_RATIO);
  const level =
    contextTokens >= compactAt || fillPct > 85
      ? "danger"
      : contextTokens >= compactAt * 0.8
        ? "warn"
        : "normal";
  const cacheHit =
    inputTokens && cachedTokens !== undefined && inputTokens > 0
      ? Math.round((cachedTokens / inputTokens) * 100)
      : null;
  const used = utils.formatTokens(contextTokens);
  const total = utils.formatWindow(maxContext);
  const tooltip =
    `Context: ${used} of ${total} tokens (${fillPct}%).` +
    (cacheHit !== null ? ` Prompt cache: ${cacheHit}% of the last request's input.` : "");

  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (fillPct / 100) * circumference;

  return (
    <Tooltip content={tooltip} side="top">
      <div className="ContextBar" data-level={level}>
        <svg className="ContextBar-ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            className="ContextBar-track"
            cx="10"
            cy="10"
            r={radius}
          />
          <circle
            className="ContextBar-fill"
            cx="10"
            cy="10"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
      </div>
    </Tooltip>
  );
});
