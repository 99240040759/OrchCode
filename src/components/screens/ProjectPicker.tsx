import { useLayoutEffect } from "react";
import { LuCloud, LuFolderOpen, LuX } from "react-icons/lu";
import { useAuthStore } from "../../lib/auth";
import { useWorkspaceStore } from "../../lib/workspace";
import { IconButton } from "../ui/Button";
import { RepoDialog, useRepoDialog } from "../projects/RepoDialog";
import { Screen } from "./Screen";

export function ProjectPicker() {
  const name = useAuthStore((s) => s.user?.displayName?.split(" ")[0]);
  const busy = useWorkspaceStore((s) => s.busy);
  const error = useWorkspaceStore((s) => s.error);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const dismissError = useWorkspaceStore((s) => s.dismissError);
  const openRepoDialog = useRepoDialog((s) => s.setOpen);

  useLayoutEffect(() => () => useRepoDialog.getState().setOpen(false), []);

  return (
    <Screen
      title={name ? `Welcome, ${name}` : "Open a project"}
      subtitle="Pick where you want to work. You can add more projects from the sidebar later."
    >
      <div className="choices" aria-busy={busy}>
        <button type="button" className="choice" disabled={busy} onClick={() => void pickAndOpen()}>
          <LuFolderOpen />
          <strong>Local folder</strong>
          <span>Work on files on this computer</span>
        </button>
        <button type="button" className="choice" disabled={busy} onClick={() => openRepoDialog(true)}>
          <LuCloud />
          <strong>GitHub repository</strong>
          <span>Work in a cloud workspace</span>
        </button>
      </div>
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss" size="sm" onClick={dismissError}>
            <LuX />
          </IconButton>
        </div>
      )}
      <RepoDialog />
    </Screen>
  );
}
