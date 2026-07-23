import { useEffect, useRef } from "react";
import { FiTerminal, FiFile } from "react-icons/fi";
import { useArtifactsStore, type ArtifactKind } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { TerminalView } from "./TerminalView";
import { FileViewer } from "./FileViewer";
import { BrowserView } from "./BrowserView";
import { Button } from "./ui/Button";

function ChromeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <img src="/chrome.svg" alt="Browser" className={className} style={{ width: 14, height: 14, flexShrink: 0, ...style }} />;
}

const EMPTY_CARDS: { kind: ArtifactKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "file", label: "File", Icon: FiFile },
  { kind: "browser", label: "Browser", Icon: ChromeIcon },
  { kind: "terminal", label: "Terminal", Icon: FiTerminal },
];

function useAutoOpenWrittenFiles() {
  const openFile = useArtifactsStore((s) => s.openFile);
  const messages = useChatStore((s) => s.messages);
  const sessionGeneration = useChatStore((s) => s.sessionGeneration);
  const processedRef = useRef<Set<string>>(new Set());
  const generationRef = useRef<number>(sessionGeneration);

  useEffect(() => {
    if (generationRef.current !== sessionGeneration) {
      generationRef.current = sessionGeneration;
      processedRef.current = new Set();
    }
    for (const msg of messages) {
      for (const item of msg.items) {
        if (item.type !== "toolCall" || item.status !== "done" || !item.displayInfo?.opensArtifact) continue;
        const path = item.displayInfo.fullPath;
        if (!path || processedRef.current.has(item.id)) continue;
        processedRef.current.add(item.id);
        openFile(path);
      }
    }
  }, [messages, sessionGeneration, openFile]);
}

export function ArtifactPanel() {
  const tabs = useArtifactsStore((s) => s.tabs);
  const activeId = useArtifactsStore((s) => s.activeId);
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

  const effectiveActiveId = activeId && tabs.some((t) => t.id === activeId) ? activeId : tabs[0]?.id ?? null;

  return (
    <aside className="ArtifactPanel" data-maximized={maximized}>
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
            <p className="ArtifactPanel-hint">Open a file, browser, or terminal. Files the agent edits show up here too.</p>
          </div>
        ) : (
          tabs.map((tab) => (
            <div key={tab.id} className="ArtifactTabPanel" data-hidden={tab.id !== effectiveActiveId}>
              {tab.kind === "terminal" && <TerminalView id={tab.id} cwd={null} />}
              {tab.kind === "file" && <FileViewer initialPath={tab.path} />}
              {tab.kind === "browser" && <BrowserView id={tab.id} initialUrl={tab.url} />}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
