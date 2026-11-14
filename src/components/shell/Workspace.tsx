import { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { useArtifactsStore } from "../../lib/artifacts";
import { ChatView } from "../chat/ChatView";
import { ArtifactPanel } from "../panel/ArtifactPanel";
import { Integrations } from "../screens/Integrations";
import { MainBar } from "./Bars";
import { useShell } from "./shellStore";

const DEFAULT_PANEL = 50;
const MOTION_MS = 320;

function layoutFor(shown: boolean, maximized: boolean, panelSize: number): [number, number] {
  if (!shown) return [100, 0];
  if (maximized) return [0, 100];
  return [100 - panelSize, panelSize];
}

function useFileWrittenEvents() {
  const fileWritten = useArtifactsStore((s) => s.fileWritten);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ path?: string }>("file-written", (event) => {
      if (event.payload?.path) fileWritten(event.payload.path);
    }).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [fileWritten]);
}

export function Workspace() {
  const view = useShell((s) => s.view);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);
  const panelShown = view === "chat" && panelOpen;
  const split = panelShown && !maximized;

  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const panelSize = useRef(DEFAULT_PANEL);
  const initial = useRef(layoutFor(panelShown, maximized, DEFAULT_PANEL)).current;
  const [moving, setMoving] = useState(false);
  useFileWrittenEvents();

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const next = layoutFor(panelShown, maximized, panelSize.current);
    const [chat, panel] = group.getLayout();
    if (Math.abs(chat - next[0]) < 0.1 && Math.abs(panel - next[1]) < 0.1) return;
    setMoving(true);
    group.setLayout(next);
    const timer = setTimeout(() => setMoving(false), MOTION_MS);
    return () => clearTimeout(timer);
  }, [panelShown, maximized]);

  const onPanelCollapse = () => {
    const artifacts = useArtifactsStore.getState();
    if (useShell.getState().view === "chat" && artifacts.panelOpen && !artifacts.maximized) artifacts.setPanelOpen(false);
  };

  const onChatCollapse = () => {
    const artifacts = useArtifactsStore.getState();
    if (artifacts.panelOpen && !artifacts.maximized) artifacts.toggleMaximized();
  };

  return (
    <PanelGroup
      ref={groupRef}
      direction="horizontal"
      className="main"
      data-moving={moving || undefined}
      data-split={split || undefined}
      onLayout={([chat, panel]) => {
        if (chat > 0 && panel > 0) panelSize.current = panel;
      }}
    >
      <Panel
        id="chat"
        order={1}
        className="pane"
        defaultSize={initial[0]}
        minSize={30}
        collapsible
        collapsedSize={0}
        onCollapse={onChatCollapse}
      >
        <section className="col col-chat">
          <MainBar panelShown={panelShown} />
          <div className="stage">
            <div className="view" hidden={view !== "chat"}>
              <ChatView />
            </div>
            {view === "integrations" && (
              <div className="view">
                <Integrations />
              </div>
            )}
          </div>
        </section>
      </Panel>
      <PanelResizeHandle className="resizer" disabled={!split} />
      <Panel
        id="panel"
        order={2}
        className="pane"
        defaultSize={initial[1]}
        minSize={25}
        collapsible
        collapsedSize={0}
        onCollapse={onPanelCollapse}
      >
        <section className="col col-panel" inert={!panelShown}>
          <ArtifactPanel visible={panelShown} />
        </section>
      </Panel>
    </PanelGroup>
  );
}
