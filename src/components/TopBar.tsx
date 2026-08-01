import {
  VscAdd,
  VscClose,
  VscFile,
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscLayoutSidebarRight,
  VscLayoutSidebarRightOff,
  VscScreenFull,
  VscScreenNormal,
  VscTerminal,
} from "react-icons/vsc";
import { activeTabId, useArtifactsStore, type ArtifactKind } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { getBasename } from "../lib/utils";
import { ChromeIcon } from "./ChromeIcon";
import FileTag from "./FileTag";
import { Button } from "./ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

const KIND_ICON: Record<ArtifactKind, React.ComponentType<{ className?: string }>> = {
  file: VscFile,
  browser: ChromeIcon,
  terminal: VscTerminal,
};

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ sidebarOpen, onToggleSidebar }: TopBarProps) {
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen);
  const tabs = useArtifactsStore((s) => s.tabs);
  const active = useArtifactsStore(activeTabId);
  const maximized = useArtifactsStore((s) => s.maximized);
  const openFile = useArtifactsStore((s) => s.openFile);
  const openBrowser = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);
  const closeTab = useArtifactsStore((s) => s.closeTab);
  const setActive = useArtifactsStore((s) => s.setActive);
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const title = sessions.find((s) => s.id === currentSessionId)?.title || "New chat";

  return (
    <div className="TopBar">
      <div className="TopBar-left">
        <Button
          className="IconBtn"
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          data-active={sidebarOpen}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <VscLayoutSidebarLeftOff /> : <VscLayoutSidebarLeft />}
        </Button>
        <span className="TopBar-title">{title}</span>
      </div>

      <div className="TopBar-right">
        {panelOpen && (
          <div className="TopBar-artifactHeader">
            <div className="ArtifactTabs">
              {tabs.map((tab) => {
                const Icon = KIND_ICON[tab.kind];
                const tabName =
                  tab.kind === "file"
                    ? tab.path
                      ? getBasename(tab.path)
                      : "Untitled file"
                    : tab.kind === "browser"
                      ? "Browser"
                      : "Terminal";
                return (
                  <div
                    key={tab.id}
                    className="ArtifactTab"
                    data-active={tab.id === active}
                    onClick={() => setActive(tab.id)}
                  >
                    {tab.kind === "file" && tab.path ? (
                      <FileTag path={tab.path} name={tabName} interactive={false} />
                    ) : (
                      <>
                        <Icon className="ArtifactTab-icon" />
                        <span className="ArtifactTab-title">{tabName}</span>
                      </>
                    )}
                    <Button
                      className="ArtifactTab-close"
                      aria-label={`Close ${tabName}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <VscClose />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="ArtifactPanel-actions">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="IconBtn" aria-label="New artifact">
                    <VscAdd />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent sideOffset={6} align="end">
                  <DropdownMenuItem onSelect={() => openFile()}>
                    <VscFile /> File
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openBrowser()}>
                    <ChromeIcon /> Browser
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openTerminal()}>
                    <VscTerminal /> Terminal
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                className="IconBtn"
                aria-label={maximized ? "Restore panel size" : "Maximize panel"}
                onClick={toggleMaximized}
              >
                {maximized ? <VscScreenNormal /> : <VscScreenFull />}
              </Button>
            </div>
          </div>
        )}

        <Button
          className="IconBtn"
          aria-label={panelOpen ? "Hide artifact panel" : "Show artifact panel"}
          data-active={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? <VscLayoutSidebarRightOff /> : <VscLayoutSidebarRight />}
        </Button>
      </div>
    </div>
  );
}

export default TopBar;
