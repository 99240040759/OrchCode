import { useState } from "react";
import { LuCloud, LuFolderOpen, LuX } from "react-icons/lu";
import { CloudMountForm } from "./CloudMountForm";
import { Titlebar } from "./ui/Titlebar";
import { useWorkspaceStore } from "../lib/workspace";

export function WorkspacePicker() {
  const busy          = useWorkspaceStore((s) => s.busy);
  const error         = useWorkspaceStore((s) => s.error);
  const pickAndOpen   = useWorkspaceStore((s) => s.pickAndOpen);
  const dismissError  = useWorkspaceStore((s) => s.dismissError);

  const [cloudMode, setCloudMode] = useState(false);

  return (
    <div className="WorkspacePicker">
      <Titlebar className="WorkspacePicker-titlebar" />

      <div className="WorkspacePicker-content">
        <img src="/icon.png" alt="" className="WorkspacePicker-logo" />
        <h1 className="WorkspacePicker-title">Choose a workspace</h1>
        <p className="WorkspacePicker-sub">
          Open a local project directory or mount a cloud repository.
        </p>

        <div className="WorkspacePicker-actions" aria-busy={busy}>
          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => void pickAndOpen()}
          >
            <LuFolderOpen className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Open local folder</span>
            <span className="WorkspacePicker-card-hint">
              Run tools locally on your machine
            </span>
          </button>

          <button
            type="button"
            className="WorkspacePicker-card"
            disabled={busy}
            onClick={() => setCloudMode((v) => !v)}
          >
            <LuCloud className="WorkspacePicker-card-icon" />
            <span className="WorkspacePicker-card-label">Mount cloud repository</span>
            <span className="WorkspacePicker-card-hint">
              Work on a Git repository in the cloud
            </span>
          </button>
        </div>

        {cloudMode && <CloudMountForm />}

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
