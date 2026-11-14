import { LuChevronDown, LuCloud, LuFolder, LuFolderOpen } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { useWorkspaceStore, workspaceMode, type WorkspaceMeta } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { useRepoDialog } from "./RepoDialog";

export function ProjectIcon({ project, open }: { project: WorkspaceMeta; open?: boolean }) {
  if (workspaceMode(project) === "cloud") return <LuCloud />;
  return open ? <LuFolderOpen /> : <LuFolder />;
}

export function OpenProjectItems() {
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const busy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const locked = busy || streaming;
  const openRepoDialog = useRepoDialog((s) => s.setOpen);
  return (
    <>
      <MenuItem disabled={locked} onSelect={() => void pickAndOpen()}>
        <LuFolderOpen />
        <span className="row-label">
          Open local folder
          <span className="menu-hint">Work on files on this computer</span>
        </span>
      </MenuItem>
      <MenuItem disabled={locked} onSelect={() => openRepoDialog(true)}>
        <LuCloud />
        <span className="row-label">
          Open GitHub repository
          <span className="menu-hint">Work in a cloud workspace</span>
        </span>
      </MenuItem>
    </>
  );
}

export function ProjectMenu() {
  const current = useWorkspaceStore((s) => s.current);
  const all = useWorkspaceStore((s) => s.all);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const busy = useWorkspaceStore((s) => s.busy);
  const streaming = useChatStore((s) => s.streaming);
  const locked = busy || streaming;

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" aria-label="Switch project" title={current?.path}>
          {current ? <ProjectIcon project={current} /> : <LuFolder />}
          <span>{current?.name ?? "Choose project"}</span>
          <LuChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" side="top">
        {all.length > 0 && <MenuLabel>Projects</MenuLabel>}
        {all.map((project) => (
          <MenuItem
            key={project.id}
            disabled={locked}
            selected={project.id === current?.id}
            onSelect={() => project.id !== current?.id && void switchTo(project.id)}
          >
            <ProjectIcon project={project} />
            <span className="row-label">{project.name}</span>
          </MenuItem>
        ))}
        {all.length > 0 && <MenuSeparator />}
        <OpenProjectItems />
      </MenuContent>
    </Menu>
  );
}
