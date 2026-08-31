/**
 * WorkspacePicker — full-screen gate shown when no workspace is active.
 *
 * Shown when workspaceStore.status === "needs_pick" | "error".
 *
 * Two actions:
 *   • Open Folder    — system folder picker, activates that dir as workspace
 *   • Quick Project  — auto-named workspace stored in AppData
 */
import { VscFolderOpened, VscRocket } from "react-icons/vsc";
import { Titlebar } from "./ui/Titlebar";
import { useWorkspaceStore } from "../lib/workspace";

export function WorkspacePicker() {
  const status        = useWorkspaceStore((s) => s.status);
  const error         = useWorkspaceStore((s) => s.error);
  const pickAndOpen   = useWorkspaceStore((s) => s.pickAndOpen);
  const createQuick   = useWorkspaceStore((s) => s.createQuickProject);
  const dismissError  = useWorkspaceStore((s) => s.dismissError);

  const busy = status === "loading";

  return (
    <div className="WorkspacePicker">
      <Titlebar className="WorkspacePicker-titlebar" />

      <div className="WorkspacePicker-content">
        <img src="/icon.png" alt="" className="WorkspacePicker-logo" />
        <h1 className="WorkspacePicker-title">Choose a workspace</h1>
        <p className="WorkspacePicker-sub">
          Every conversation is tied to a workspace folder. Pick an existing
          project or start a fresh quick project.
        </p>

        <div className="WorkspacePicker-actions">
          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void pickAndOpen()}
          >
            <VscFolderOpened className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Open folder</span>
            <span className="WorkspacePicker-card-hint">
              Choose an existing project directory
            </span>
          </button>

          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void createQuick()}
          >
            <VscRocket className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Quick project</span>
            <span className="WorkspacePicker-card-hint">
              Auto-named workspace, stored in app data
            </span>
          </button>
        </div>

        {error && (
          <div
            className="WorkspacePicker-error"
            role="alert"
            onClick={dismissError}
          >
            {error}
            <span className="WorkspacePicker-error-dismiss" aria-label="Dismiss">×</span>
          </div>
        )}
      </div>
    </div>
  );
}
