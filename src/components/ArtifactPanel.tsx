import { lazy, Suspense, useEffect, useRef } from "react";
import {
  LuFolderTree,
  LuMaximize2,
  LuMinimize2,
  LuPlus,
  LuTerminal,
  LuX,
} from "react-icons/lu";
import { listen } from "@tauri-apps/api/event";
import { activeTabId, useArtifactsStore, type ArtifactTab } from "../lib/artifacts";
import { useWorkspaceStore } from "../lib/workspace";
import { getBasename } from "../lib/utils";
import { BrowserView } from "./BrowserView";
import { ChromeIcon, ExplorerIcon } from "./ChatPrimitives";
import { ExplorerPane } from "./ExplorerPane";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

const FileViewer = lazy(() => import("./FileViewer").then((m) => ({ default: m.FileViewer })));
const PdfViewer = lazy(() => import("./viewers/PdfViewer").then((m) => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import("./viewers/DocxViewer").then((m) => ({ default: m.DocxViewer })));
const XlsxViewer = lazy(() => import("./viewers/XlsxViewer").then((m) => ({ default: m.XlsxViewer })));
const PptxViewer = lazy(() => import("./viewers/PptxViewer").then((m) => ({ default: m.PptxViewer })));

const VIEWER_FALLBACK = (
  <div className="FileViewerLoading">
    <div className="Spinner" />
  </div>
);
function ArtifactTabIcon({ tab, tabName }: { tab: ArtifactTab; tabName: string }) {
  if (tab.kind === "browser") return <ChromeIcon className="ArtifactTab-icon" />;
  if (tab.kind === "terminal") return <LuTerminal className="ArtifactTab-icon" />;
  const name = tab.path ? getBasename(tab.path) : `${tabName}.${tab.kind}`;
  return (
    <ExplorerIcon
      type="file"
      name={name}
      className="ArtifactTab-icon"
    />
  );
}

const EMPTY_CARDS = [
  { kind: "explorer" as const, label: "Explorer", Icon: LuFolderTree },
  { kind: "browser" as const, label: "Browser", Icon: ChromeIcon },
  { kind: "terminal" as const, label: "Terminal", Icon: LuTerminal },
];

function useFileWrittenListener() {
  const fileWritten = useArtifactsStore((s) => s.fileWritten);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ path?: string }>("file-written", (event) => {
      const path = event.payload?.path;
      if (path) fileWritten(path);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [fileWritten]);
}

function ArtifactPanelHeader() {
  const tabs          = useArtifactsStore((s) => s.tabs);
  const active        = useArtifactsStore(activeTabId);
  const maximized     = useArtifactsStore((s) => s.maximized);
  const showExplorer  = useArtifactsStore((s) => s.showExplorer);
  const openBrowser   = useArtifactsStore((s) => s.openBrowser);
  const openTerminal  = useArtifactsStore((s) => s.openTerminal);
  const closeTab      = useArtifactsStore((s) => s.closeTab);
  const setActive     = useArtifactsStore((s) => s.setActive);
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized);
  const explorerOpen = useArtifactsStore((s) => s.explorerOpen);
  const toggleExplorer = useArtifactsStore((s) => s.toggleExplorer);

  return (
    <div className="ArtifactPanel-header">
      <div className="ArtifactTabs">
        {tabs.map((tab) => {
          const tabName =
            tab.kind === "file"
              ? getBasename(tab.path ?? "")
              : tab.kind === "browser"
                ? "Browser"
                : tab.kind === "terminal"
                  ? tab.label ?? "Terminal"
                  : tab.label ?? (tab.path ? getBasename(tab.path) : tab.kind.toUpperCase());
          const isFileTab = tab.kind === "file" && Boolean(tab.path);
          return (
            <div
              key={tab.id}
              className="ArtifactTab"
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === active}
              data-active={tab.id === active}
              data-file={isFileTab || undefined}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActive(tab.id);
                }
              }}
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
                    <LuX />
                  </span>
                </button>
              </Tooltip>
              <span className="ArtifactTab-title">{tabName}</span>
            </div>
          );
        })}

        <DropdownMenu>
          <Tooltip content="New tab" side="bottom">
            <DropdownMenuTrigger asChild>
              <Button className="IconBtn ArtifactTabs-addBtn" aria-label="New artifact">
                <LuPlus />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent sideOffset={6} align="start">
            <DropdownMenuItem onSelect={showExplorer}>
              <LuFolderTree /> Explorer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openBrowser()}>
              <ChromeIcon /> Browser
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openTerminal()}>
              <LuTerminal /> Terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ArtifactPanel-actions">
        <Tooltip content={explorerOpen ? "Hide file explorer" : "Show file explorer"} side="bottom">
          <Button
            className="IconBtn"
            aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
            aria-pressed={explorerOpen}
            data-active={explorerOpen}
            onClick={toggleExplorer}
          >
            <LuFolderTree />
          </Button>
        </Tooltip>
        <Tooltip content={maximized ? "Restore panel size" : "Maximize panel"} side="bottom">
          <Button
            className="IconBtn"
            aria-label={maximized ? "Restore panel size" : "Maximize panel"}
            onClick={toggleMaximized}
          >
            {maximized ? <LuMinimize2 /> : <LuMaximize2 />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function DocumentViewer({ kind, path, active }: { kind: ArtifactTab["kind"]; path: string; active: boolean }) {
  const version = useArtifactsStore((s) => s.fileVersions[path] ?? 0);
  const key = `${path}:${version}`;
  if (kind === "pdf") return <PdfViewer key={key} path={path} active={active} />;
  if (kind === "docx") return <DocxViewer key={key} path={path} />;
  if (kind === "xlsx") return <XlsxViewer key={key} path={path} />;
  if (kind === "pptx") return <PptxViewer key={key} path={path} active={active} />;
  return null;
}

function TabContent({ tab, active }: { tab: ArtifactTab; active: boolean }) {
  const hasRendered = useRef(active);
  if (active) hasRendered.current = true;
  if (!hasRendered.current) return null;

  const stateful = tab.kind === "terminal" || tab.kind === "browser";
  return (
    <div
      className="ArtifactTabPanel"
      style={{ display: active ? undefined : "none" }}
      aria-hidden={!active}
    >
      {tab.kind === "terminal" && <TerminalView id={tab.id} />}
      {tab.kind === "browser" && <BrowserView initialUrl={tab.url} active={active} />}
      {!stateful && (
        <Suspense fallback={VIEWER_FALLBACK}>
          {tab.path &&
            (tab.kind === "file" ? (
              <FileViewer path={tab.path} />
            ) : (
              <DocumentViewer kind={tab.kind} path={tab.path} active={active} />
            ))}
        </Suspense>
      )}
    </div>
  );
}

export function ArtifactPanel({ visible = true }: { visible?: boolean }) {
  const tabs      = useArtifactsStore((s) => s.tabs);
  const active    = useArtifactsStore(activeTabId);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const showExplorer = useArtifactsStore((s) => s.showExplorer);
  const openBrowser  = useArtifactsStore((s) => s.openBrowser);
  const openTerminal = useArtifactsStore((s) => s.openTerminal);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const explorerOpen = useArtifactsStore((s) => s.explorerOpen);

  useFileWrittenListener();

  const isPanelActive = panelOpen && visible;

  return (
    <aside className="ArtifactPanel">
      <ArtifactPanelHeader />
      <div className="ArtifactPanel-split">
        <div className="ArtifactPanel-body">
          {tabs.length === 0 ? (
            <div className="ArtifactEmpty">
              <div className="ArtifactCards">
                {EMPTY_CARDS.map(({ kind, label, Icon }) => (
                  <Button
                    key={kind}
                    className="ArtifactCard"
                    onClick={() => {
                      if (kind === "explorer") showExplorer();
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
                active={isPanelActive && tab.id === active}
              />
            ))
          )}
        </div>
        {explorerOpen && <ExplorerPane key={workspaceId} />}
      </div>
    </aside>
  );
}
