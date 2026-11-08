import React from "react";
import { LuArrowUp, LuMic, LuSquare } from "react-icons/lu";
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
              ? "Composer-micBtn Composer-mic-active"
              : "Composer-micBtn"
          }
          aria-label={recording ? "Stop dictation" : "Start voice dictation"}
          onClick={onToggleDictation}
          disabled={streaming}
        >
          {recording ? <LuSquare /> : <LuMic />}
        </Button>
      </Tooltip>

      {streaming ? (
        <Tooltip content="Stop generating" side="top">
          <Button
            className="Composer-send Composer-stop"
            aria-label="Stop generating"
            onClick={onCancel}
          >
            <LuSquare />
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
            <LuArrowUp />
          </Button>
        </Tooltip>
      )}
    </div>
  );
});
