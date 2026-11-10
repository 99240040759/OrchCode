import { LuCloud, LuFolderOpen, LuX } from "react-icons/lu";
import { Titlebar } from "./ui/Titlebar";
import { useWorkspaceStore } from "../lib/workspace";

export function WorkspacePicker() {
  const busy          = useWorkspaceStore((s) => s.busy);
  const error         = useWorkspaceStore((s) => s.error);
  const pickAndOpen   = useWorkspaceStore((s) => s.pickAndOpen);
  const dismissError  = useWorkspaceStore((s) => s.dismissError);
  const setMode         = useWorkspaceStore((s) => s.setMode);

  return (
    <div className="WorkspacePicker">
      <Titlebar className="WorkspacePicker-titlebar" />

      <div className="WorkspacePicker-content">
        <img src="/icon.png" alt="" className="WorkspacePicker-logo" />
        <h1 className="WorkspacePicker-title">Choose a workspace</h1>
        <p className="WorkspacePicker-sub">
          Work on this computer or in the cloud.
        </p>

        <div className="WorkspacePicker-actions" aria-busy={busy}>
          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void pickAndOpen()}
          >
            <LuFolderOpen className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">This computer</span>
            <span className="WorkspacePicker-card-hint">
              Open a folder
            </span>
          </button>

          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void setMode("cloud")}
          >
            <LuCloud className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Cloud</span>
            <span className="WorkspacePicker-card-hint">
              Choose a GitHub repo
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
