import { FiSidebar, FiFile, FiTerminal, FiPlus, FiX, FiMaximize2, FiMinimize2 } from "react-icons/fi";
import { Button } from "./ui/Button";
import { useArtifactsStore, type ArtifactKind } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { getBasename } from "../lib/utils";
import FileTag from "./FileTag";
import { ChromeIcon } from "./ChromeIcon";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/DropdownMenu";

const KIND_ICON: Record<ArtifactKind, React.ComponentType<{ className?: string }>> = {
  file: FiFile,
  browser: ChromeIcon,
  terminal: FiTerminal,
};

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ sidebarOpen, onToggleSidebar }: TopBarProps) {
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen);
  const tabs = useArtifactsStore((s) => s.tabs);
  const activeId = useArtifactsStore((s) => s.activeId);
  const maximized = useArtifactsStore((s) => s.maximized);
  const openFile = useArtifactsStore((s) => s.openFile);
  const openBrowser = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);
  const closeTab = useArtifactsStore((s) => s.closeTab);
  const setActive = useArtifactsStore((s) => s.setActive);
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const activeTitle = currentSession?.title || "New chat";
  const effectiveActiveId = activeId && tabs.some((t) => t.id === activeId) ? activeId : tabs[0]?.id ?? null;

  return (
    <div className="TopBar">
      <div className="TopBar-left">
        <Button className="IconBtn" aria-label="Toggle sidebar" data-active={sidebarOpen} onClick={onToggleSidebar}>
          <FiSidebar />
        </Button>
        <span className="TopBar-title">{activeTitle}</span>
      </div>

      <div className="TopBar-right">
        {panelOpen ? (
          <div className="TopBar-artifactHeader">
            <div className="ArtifactTabs">
              {tabs.map((tab) => {
                const Icon = KIND_ICON[tab.kind];
                const tabName = tab.kind === "file" ? (tab.path ? getBasename(tab.path) : "File") : tab.kind === "browser" ? "Browser" : "Terminal";
                return (
                  <div key={tab.id} className="ArtifactTab" data-active={tab.id === effectiveActiveId} onClick={() => setActive(tab.id)}>
                    {tab.kind === "file" ? (
                      <FileTag path={tab.path ?? ""} name={tabName} interactive={false} />
                    ) : (
                      <>
                        <Icon className="ArtifactTab-icon" />
                        <span className="ArtifactTab-title">{tabName}</span>
                      </>
                    )}
                    <Button className="ArtifactTab-close" aria-label={`Close ${tabName}`} onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>
                      <FiX />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="ArtifactPanel-actions">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="IconBtn" aria-label="New artifact"><FiPlus /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent sideOffset={6} align="end">
                  <DropdownMenuItem onSelect={() => openFile()}><FiFile /> File</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openBrowser()}><ChromeIcon /> Browser</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openTerminal()}><FiTerminal /> Terminal</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button className="IconBtn" aria-label={maximized ? "Restore panel" : "Maximize panel"} onClick={toggleMaximized}>
                {maximized ? <FiMinimize2 /> : <FiMaximize2 />}
              </Button>

              <Button className="IconBtn IconBtn-rightpanel" aria-label="Close panel" data-active={true} onClick={() => setPanelOpen(false)}>
                <FiSidebar />
              </Button>
            </div>
          </div>
        ) : (
          <Button className="IconBtn IconBtn-rightpanel" aria-label="Toggle artifact panel" data-active={false} onClick={() => setPanelOpen(true)}>
            <FiSidebar />
          </Button>
        )}
      </div>
    </div>
  );
}
