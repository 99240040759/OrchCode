import { LuFolderOpen, LuX } from "react-icons/lu";
import { Titlebar } from "./ui/Titlebar";
import { useWorkspaceStore } from "../lib/workspace";

export function WorkspacePicker() {
  const busy         = useWorkspaceStore((s) => s.busy);
  const error        = useWorkspaceStore((s) => s.error);
  const pickAndOpen  = useWorkspaceStore((s) => s.pickAndOpen);
  const dismissError = useWorkspaceStore((s) => s.dismissError);

  return (
    <div className="WorkspacePicker">
      <Titlebar className="WorkspacePicker-titlebar" />

      <div className="WorkspacePicker-content">
        <img src="/icon.png" alt="" className="WorkspacePicker-logo" />
        <h1 className="WorkspacePicker-title">Choose a workspace</h1>
        <p className="WorkspacePicker-sub">
          Every conversation is tied to a workspace folder. Pick an existing
          project directory to get started.
        </p>

        <div className="WorkspacePicker-actions" aria-busy={busy}>
          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void pickAndOpen()}
          >
            <LuFolderOpen className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Open folder</span>
            <span className="WorkspacePicker-card-hint">
              Choose an existing project directory
            </span>
          </button>
        </div>

        {error && (
          <div className="WorkspacePicker-error" role="alert">
            {error}
            <button
              type="button"
              className="WorkspacePicker-error-dismiss"
              aria-label="Dismiss error"
              onClick={dismissError}
            >
              <LuX />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
