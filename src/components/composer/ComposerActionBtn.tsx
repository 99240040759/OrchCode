import React from "react";
import { VscArrowRight, VscDebugStop, VscMic } from "react-icons/vsc";
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
  return (
    <div className="Composer-actions">
      <Tooltip content={recording ? "Stop dictation" : "Voice dictation"} side="top">
        <Button
          className={
            recording
              ? "Composer-micBtn Composer-mic-send"
              : "Composer-micBtn"
          }
          aria-label={recording ? "Stop dictation" : "Start voice dictation"}
          onClick={onToggleDictation}
          disabled={streaming}
        >
          {recording ? (
            <span className="Composer-micWaves" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
          ) : (
            <VscMic />
          )}
        </Button>
      </Tooltip>

      {streaming ? (
        <Tooltip content="Stop generating" side="top">
          <Button
            className="Composer-send Composer-stop"
            aria-label="Stop generating"
            onClick={onCancel}
          >
            <VscDebugStop />
          </Button>
        </Tooltip>
      ) : (
        <Tooltip content="Send message (Enter)" side="top">
          <Button
            className="Composer-send"
            aria-label="Send message"
            disabled={!canSend}
            onClick={onSend}
          >
            <VscArrowRight />
          </Button>
        </Tooltip>
      )}
    </div>
  );
});
