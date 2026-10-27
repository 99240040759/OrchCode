import React from "react";
import { VscArrowUp, VscDebugStop, VscMic } from "react-icons/vsc";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";

interface ComposerActionBtnProps {
  streaming: boolean;
  recording: boolean;
  canSend: boolean;
  onSend: () => void;
  onCancel: () => void;
  onToggleDictation: () => void;
}

export const ComposerActionBtn = React.memo(function ComposerActionBtn({
  streaming,
  recording,
  canSend,
  onSend,
  onCancel,
  onToggleDictation,
}: ComposerActionBtnProps) {
  let mode: "streaming" | "recording" | "send" | "idle";
  if (streaming) mode = "streaming";
  else if (recording) mode = "recording";
  else if (canSend) mode = "send";
  else mode = "idle";

  const config = {
    streaming: {
      tooltip: "Stop generating",
      ariaLabel: "Stop generating",
      className: "Composer-send Composer-stop",
      icon: <VscDebugStop />,
      onClick: onCancel,
    },
    recording: {
      tooltip: "Stop dictation",
      ariaLabel: "Stop dictation",
      className: "Composer-send Composer-mic-send",
      icon: (
        <span className="Composer-micWaves" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      ),
      onClick: onToggleDictation,
    },
    send: {
      tooltip: "Send message (Enter)",
      ariaLabel: "Send message",
      className: "Composer-send",
      icon: <VscArrowUp />,
      onClick: onSend,
    },
    idle: {
      tooltip: "Voice dictation",
      ariaLabel: "Start voice dictation",
      className: "Composer-send Composer-mic-idle",
      icon: <VscMic />,
      onClick: onToggleDictation,
    },
  }[mode];

  return (
    <Tooltip content={config.tooltip} side="top">
      <Button
        className={config.className}
        aria-label={config.ariaLabel}
        onClick={config.onClick}
      >
        {config.icon}
      </Button>
    </Tooltip>
  );
});
