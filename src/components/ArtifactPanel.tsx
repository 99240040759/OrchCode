import { useEffect } from "react";
import {
  VscAdd,
  VscClose,
  VscScreenFull,
  VscScreenNormal,
  VscTerminal,
} from "react-icons/vsc";
import { RiFolderOpenLine } from "react-icons/ri";
import { listen } from "@tauri-apps/api/event";
import { activeTabId, useArtifactsStore, type ArtifactTab } from "../lib/artifacts";
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
  if (tab.kind === "browser") return <ChromeIcon className="ArtifactTab-icon" />;
  if (tab.kind === "terminal") return <VscTerminal className="ArtifactTab-icon" />;
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

const EMPTY_CARDS = [
  { kind: "file" as const, label: "Explorer", Icon: RiFolderOpenLine },
  { kind: "browser" as const, label: "Browser", Icon: ChromeIcon },
  { kind: "terminal" as const, label: "Terminal", Icon: VscTerminal },
];

function useFileWrittenListener() {
  const openFile     = useArtifactsStore((s) => s.openFile);
  const openDocument = useArtifactsStore((s) => s.openDocument);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("file-written", (event) => {
      const path = event.payload;
      if (!path) return;
      const kind = documentArtifactKindForPath(path);
      if (kind) openDocument(path, kind);
      else openFile(path);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [openFile, openDocument]);
}

function ArtifactPanelHeader() {
  const tabs          = useArtifactsStore((s) => s.tabs);
  const active        = useArtifactsStore(activeTabId);
  const maximized     = useArtifactsStore((s) => s.maximized);
  const openFile      = useArtifactsStore((s) => s.openFile);
  const openBrowser   = useArtifactsStore((s) => s.openBrowser);
  const openTerminal  = useArtifactsStore((s) => s.openTerminal);
  const closeTab      = useArtifactsStore((s) => s.closeTab);
  const setActive     = useArtifactsStore((s) => s.setActive);
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized);

  return (
    <div className="ArtifactPanel-header">
      <div className="ArtifactTabs">
        {tabs.map((tab) => {
          const tabName =
            tab.kind === "file"
              ? tab.path ? getBasename(tab.path) : "Explorer"
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
              <RiFolderOpenLine /> Explorer
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

function TabContent({ tab, active }: { tab: ArtifactTab; active: boolean }) {
  return (
    <div
      className="ArtifactTabPanel"
      style={{ display: active ? undefined : "none" }}
      aria-hidden={!active}
    >
      {tab.kind === "terminal" && <TerminalView id={tab.id} />}
      {tab.kind === "file" && <FileViewer tabId={tab.id} path={tab.path} />}
      {tab.kind === "browser" && <BrowserView initialUrl={tab.url} />}
      {tab.kind === "pdf" && tab.path && <PdfViewer path={tab.path} />}
      {tab.kind === "docx" && tab.path && <DocxViewer path={tab.path} />}
      {tab.kind === "xlsx" && tab.path && <XlsxViewer path={tab.path} />}
      {tab.kind === "pptx" && tab.path && <PptxViewer path={tab.path} />}
    </div>
  );
}

export function ArtifactPanel() {
  const tabs      = useArtifactsStore((s) => s.tabs);
  const active    = useArtifactsStore(activeTabId);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);
  const openFile     = useArtifactsStore((s) => s.openFile);
  const openBrowser  = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);

  useFileWrittenListener();

  return (
    <aside className="ArtifactPanel" data-maximized={maximized}>
      <ArtifactPanelHeader />
      <div className="ArtifactPanel-body">
        {tabs.length === 0 ? (
          <div className="ArtifactEmpty">
            <div className="ArtifactCards">
              {EMPTY_CARDS.map(({ kind, label, Icon }) => (
                <Button
                  key={kind}
                  className="ArtifactCard"
                  onClick={() => {
                    if (kind === "file") openFile();
                    else if (kind === "browser") openBrowser();
                    else openTerminal();
                  }}
                >
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
          tabs.map((tab) => (
            <TabContent
              key={tab.id}
              tab={tab}
              active={panelOpen && tab.id === active}
            />
          ))
        )}
      </div>
    </aside>
  );
}
