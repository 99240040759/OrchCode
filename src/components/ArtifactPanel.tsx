import { useEffect, useRef } from "react";
import {
  VscAdd,
  VscClose,
  VscFile,
  VscScreenFull,
  VscScreenNormal,
  VscTerminal,
} from "react-icons/vsc";
import { activeTabId, useArtifactsStore, type ArtifactKind, type ArtifactTab } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { documentArtifactKindForPath, getBasename } from "../lib/api";
import { BrowserView } from "./BrowserView";
import { ChromeIcon, ExplorerIcon } from "./ChatPrimitives";
import { FileViewer } from "./FileViewer";
import { TerminalView } from "./TerminalView";
import { PdfViewer } from "./viewers/PdfViewer";
import { DocxViewer } from "./viewers/DocxViewer";
import { XlsxViewer } from "./viewers/XlsxViewer";
import { PptxViewer } from "./viewers/PptxViewer";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

function ArtifactTabIcon({ tab, tabName }: { tab: ArtifactTab; tabName: string }) {
  if (tab.kind === "browser") {
    return <ChromeIcon className="ArtifactTab-icon" />;
  }
  if (tab.kind === "terminal") {
    return <VscTerminal className="ArtifactTab-icon" />;
  }
  const name = tab.path ? getBasename(tab.path) : `${tabName}.${tab.kind}`;
  return (
    <ExplorerIcon
      type="file"
      name={name}
      className="ArtifactTab-icon"
      width={14}
      height={14}
    />
  );
}

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
  const openDocument = useArtifactsStore((s) => s.openDocument);
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

        const kind = documentArtifactKindForPath(path);
        if (kind) openDocument(path, kind);
        else {
          openFile(path);
          bumpFile(path);
        }
      }
    }
  }, [messages, generation, openFile, openDocument, bumpFile]);
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
      <div className="ArtifactTabs">
        {tabs.map((tab) => {
          const tabName =
            tab.kind === "file"
              ? tab.path
                ? getBasename(tab.path)
                : "Untitled file"
              : tab.kind === "browser"
                ? "Browser"
                : tab.kind === "terminal"
                  ? "Terminal"
                  : tab.label ?? (tab.path ? getBasename(tab.path) : tab.kind.toUpperCase());
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
                    <ArtifactTabIcon tab={tab} tabName={tabName} />
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
  const activeTab = tabs.find((tab) => tab.id === active);
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
        ) : activeTab && panelOpen ? (
          <div key={activeTab.id} className="ArtifactTabPanel">
            {activeTab.kind === "terminal" && <TerminalView id={activeTab.id} />}
            {activeTab.kind === "file" && (
              <FileViewer tabId={activeTab.id} path={activeTab.path} />
            )}
            {activeTab.kind === "browser" && <BrowserView initialUrl={activeTab.url} />}
            {activeTab.kind === "pdf" && activeTab.path && <PdfViewer path={activeTab.path} />}
            {activeTab.kind === "docx" && activeTab.path && (
              <DocxViewer path={activeTab.path} documentId={activeTab.documentId} />
            )}
            {activeTab.kind === "xlsx" && activeTab.path && <XlsxViewer path={activeTab.path} />}
            {activeTab.kind === "pptx" && activeTab.path && <PptxViewer path={activeTab.path} />}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default ArtifactPanel;
