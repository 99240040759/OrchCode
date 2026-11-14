import { useEffect, useRef } from "react";
import { Group, Panel, Separator, useGroupRef, type Layout } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { useArtifactsStore } from "../../lib/artifacts";
import { ChatView } from "../chat/ChatView";
import { ArtifactPanel } from "../panel/ArtifactPanel";
import { Integrations } from "../screens/Integrations";
import { MainBar } from "./Bars";
import { useShell } from "./shellStore";

const DEFAULT_PANEL_PCT = 50;

function layoutFor(shown: boolean, maximized: boolean, panelPct: number): Layout {
  if (!shown) return { chat: 100, artifacts: 0 };
  if (maximized) return { chat: 0, artifacts: 100 };
  return { chat: 100 - panelPct, artifacts: panelPct };
}

function sameLayout(a: Layout, b: Layout): boolean {
  return Math.abs((a.chat ?? 0) - (b.chat ?? 0)) < 0.1 && Math.abs((a.artifacts ?? 0) - (b.artifacts ?? 0)) < 0.1;
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

  const groupRef = useGroupRef();
  const panelPct = useRef(DEFAULT_PANEL_PCT);
  const initialLayout = useRef(layoutFor(panelShown, maximized, DEFAULT_PANEL_PCT)).current;
  useFileWrittenEvents();

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const next = layoutFor(panelShown, maximized, panelPct.current);
    if (sameLayout(group.getLayout(), next)) return;
    group.setLayout(next);
  }, [panelShown, maximized, groupRef]);

  return (
    <Group
      orientation="horizontal"
      className="workspace"
      groupRef={groupRef}
      defaultLayout={initialLayout}
      data-maximized={(panelShown && maximized) || undefined}
      onLayoutChanged={(layout, meta) => {
        const chat = layout.chat ?? 0;
        const artifacts = layout.artifacts ?? 0;
        if (chat > 0 && artifacts > 0) panelPct.current = artifacts;
        if (!meta.isUserInteraction) return;
        const store = useArtifactsStore.getState();
        if (!store.panelOpen || store.maximized) return;
        if (artifacts === 0) store.setPanelOpen(false);
        else if (chat === 0) store.toggleMaximized();
      }}
    >
      <Panel id="chat" className="pane" style={{ overflow: "hidden" }} minSize={360} collapsible collapsedSize={0}>
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
      <Separator className="gutter" disabled={!split} />
      <Panel id="artifacts" className="pane" style={{ overflow: "hidden" }} minSize={340} collapsible collapsedSize={0}>
        <section className="col col-panel" inert={!panelShown}>
          <ArtifactPanel visible={panelShown} />
        </section>
      </Panel>
    </Group>
  );
}
