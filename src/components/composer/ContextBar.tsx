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
  const markPct = Math.min(100, Math.round((compactAt / maxContext) * 100));
  const cacheHit =
    inputTokens && cachedTokens !== undefined && inputTokens > 0
      ? Math.round((cachedTokens / inputTokens) * 100)
      : null;
  const used = utils.formatTokens(contextTokens);
  const total = utils.formatWindow(maxContext);
  const tooltip =
    `Context: ${used} of ${total} tokens (${fillPct}%).` +
    (cacheHit !== null ? ` Prompt cache: ${cacheHit}% of the last request's input.` : "");

  return (
    <Tooltip content={tooltip} side="top">
      <div className="ContextBar" data-level={level}>
        <div className="ContextBar-track">
          <div className="ContextBar-fill" style={{ width: `${fillPct}%` }} />
          <div className="ContextBar-mark" style={{ left: `${markPct}%` }} />
        </div>
      </div>
    </Tooltip>
  );
});
