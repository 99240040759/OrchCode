import { useEffect, useRef } from "react";
import { FiFile, FiTerminal } from "react-icons/fi";
import { activeTabId, useArtifactsStore, type ArtifactKind } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { BrowserView } from "./BrowserView";
import { ChromeIcon } from "./ChromeIcon";
import { FileViewer } from "./FileViewer";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/Button";

const EMPTY_CARDS: {
  kind: ArtifactKind;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "file", label: "File", Icon: FiFile },
  { kind: "browser", label: "Browser", Icon: ChromeIcon },
  { kind: "terminal", label: "Terminal", Icon: FiTerminal },
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

export function ArtifactPanel() {
  const tabs = useArtifactsStore((s) => s.tabs);
  const active = useArtifactsStore(activeTabId);
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
          tabs.map((tab) => (
            <div key={tab.id} className="ArtifactTabPanel" data-hidden={tab.id !== active}>
              {tab.kind === "terminal" && <TerminalView id={tab.id} />}
              {tab.kind === "file" && <FileViewer tabId={tab.id} path={tab.path} />}
              {tab.kind === "browser" && <BrowserView id={tab.id} initialUrl={tab.url} />}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default ArtifactPanel;
