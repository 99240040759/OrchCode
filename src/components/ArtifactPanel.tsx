import { useEffect, useRef } from "react";
import {
  VscAdd,
  VscClose,
  VscFile,
  VscScreenFull,
  VscScreenNormal,
  VscTerminal,
} from "react-icons/vsc";
import { activeTabId, useArtifactsStore, type ArtifactKind } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { getBasename } from "../lib/api";
import { BrowserView } from "./BrowserView";
import { ChromeIcon, ExplorerIcon } from "./ChatPrimitives";
import { FileViewer } from "./FileViewer";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
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

const EMPTY_CARDS: {
  kind: ArtifactKind;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "file", label: "File", Icon: VscFile },
  { kind: "browser", label: "Browser", Icon: ChromeIcon },
  { kind: "terminal", label: "Terminal", Icon: VscTerminal },
];

function useAutoOpenWrittenFiles() {
  const openFile = useArtifactsStore((s) => s.openFile);
  const bumpFile = useArtifactsStore((s) => s.bumpFile);
  const messages = useChatStore((s) => s.messages);
  const generation = useChatStore((s) => s.sessionGeneration);

  const seenRunning = useRef<Set<string>>(new Set());
  const opened = useRef<Set<string>>(new Set());
  const lastGeneration = useRef(generation);

  useEffect(() => {
    if (lastGeneration.current !== generation) {
      lastGeneration.current = generation;
      seenRunning.current = new Set();
      opened.current = new Set();
    }

    for (const message of messages) {
      for (const item of message.items) {
        if (item.type !== "toolCall") continue;
        if (item.status === "running") {
          seenRunning.current.add(item.id);
          continue;
        }
        if (!seenRunning.current.has(item.id)) continue;
        if (!item.displayInfo.opensArtifact) continue;
        const path = item.displayInfo.fullPath;
        if (!path || opened.current.has(item.id)) continue;
        opened.current.add(item.id);
        openFile(path);
        bumpFile(path);
      }
    }
  }, [messages, generation, openFile, bumpFile]);
}

function ArtifactPanelHeader() {
  const tabs = useArtifactsStore((s) => s.tabs);
  const active = useArtifactsStore(activeTabId);
  const maximized = useArtifactsStore((s) => s.maximized);
  const openFile = useArtifactsStore((s) => s.openFile);
  const openBrowser = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);
  const closeTab = useArtifactsStore((s) => s.closeTab);
  const setActive = useArtifactsStore((s) => s.setActive);
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized);


  return (
    <div className="ArtifactPanel-header">
      {/* Tabs */}
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
              <Tooltip content={`Close ${tabName}`} side="bottom">
                <button
                  type="button"
                  className="ArtifactTab-iconWrap"
                  aria-label={`Close ${tabName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <span className="ArtifactTab-iconMain">
                    {tab.kind === "file" && tab.path ? (
                      <ExplorerIcon
                        type="file"
                        name={tabName}
                        className="ArtifactTab-icon"
                        width={14}
                        height={14}
                      />
                    ) : (
                      <Icon className="ArtifactTab-icon" />
                    )}
                  </span>
                  <span className="ArtifactTab-iconClose" aria-hidden="true">
                    <VscClose />
                  </span>
                </button>
              </Tooltip>
              <span className="ArtifactTab-title">{tabName}</span>
            </div>
          );
        })}
      </div>

      {/* Right actions */}
      <div className="ArtifactPanel-actions">
        <DropdownMenu>
          <Tooltip content="New tab" side="bottom">
            <DropdownMenuTrigger asChild>
              <Button className="IconBtn" aria-label="New artifact">
                <VscAdd />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
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

        <Tooltip content={maximized ? "Restore panel size" : "Maximize panel"} side="bottom">
          <Button
            className="IconBtn"
            aria-label={maximized ? "Restore panel size" : "Maximize panel"}
            onClick={toggleMaximized}
          >
            {maximized ? <VscScreenNormal /> : <VscScreenFull />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

export function ArtifactPanel() {
  const tabs = useArtifactsStore((s) => s.tabs);
  const active = useArtifactsStore(activeTabId);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);
  const openFile = useArtifactsStore((s) => s.openFile);
  const openBrowser = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);

  useAutoOpenWrittenFiles();

  const openKind = (kind: ArtifactKind) => {
    if (kind === "file") openFile();
    else if (kind === "browser") openBrowser();
    else openTerminal();
  };

  return (
    <aside className="ArtifactPanel" data-maximized={maximized}>
      <ArtifactPanelHeader />
      <div className="ArtifactPanel-body">
        {tabs.length === 0 ? (
          <div className="ArtifactEmpty">
            <div className="ArtifactCards">
              {EMPTY_CARDS.map(({ kind, label, Icon }) => (
                <Button key={kind} className="ArtifactCard" onClick={() => openKind(kind)}>
                  <Icon />
                  <span className="ArtifactCard-label">{label}</span>
                </Button>
              ))}
            </div>
            <p className="ArtifactPanel-hint">
              Open a file, browser, or terminal. Files the agent edits show up here too.
            </p>
          </div>
        ) : (
          tabs.map((tab) => {
            const isTabActive = tab.id === active && panelOpen;
            return (
              <div key={tab.id} className="ArtifactTabPanel" data-hidden={!isTabActive}>
                {tab.kind === "terminal" && <TerminalView id={tab.id} />}
                {tab.kind === "file" && <FileViewer tabId={tab.id} path={tab.path} />}
                {tab.kind === "browser" && (
                  <BrowserView initialUrl={tab.url} active={isTabActive} />
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default ArtifactPanel;
