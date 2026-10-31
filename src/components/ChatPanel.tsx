import { useEffect, useRef, useState } from "react";
import { VscClose } from "react-icons/vsc";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { useArtifactsStore } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { ArtifactPanel } from "./ArtifactPanel";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";

function chatSizeFor(panelOpen: boolean, maximized: boolean): number {
  if (!panelOpen) return 100;
  return maximized ? 0 : 60;
}

export function ChatPanel({ visible = true }: { visible?: boolean }) {
  const hasMessages  = useChatStore((s) => s.messages.length > 0);
  const error        = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const panelOpen    = useArtifactsStore((s) => s.panelOpen);
  const maximized    = useArtifactsStore((s) => s.maximized);

  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const initialChatSize = useRef(chatSizeFor(panelOpen, maximized)).current;
  const artifactPanelRef = useRef<HTMLDivElement>(null);
  const [animating, setAnimating] = useState(false);
  const prevLayoutRef = useRef({ panelOpen, maximized });

  useEffect(() => {
    const prev = prevLayoutRef.current;
    const changed = prev.panelOpen !== panelOpen || prev.maximized !== maximized;
    prevLayoutRef.current = { panelOpen, maximized };

    const chat = chatSizeFor(panelOpen, maximized);
    if (changed) {
      setAnimating(true);
      groupRef.current?.setLayout([chat, 100 - chat]);
      const timer = window.setTimeout(() => setAnimating(false), 200);
      return () => window.clearTimeout(timer);
    }
    groupRef.current?.setLayout([chat, 100 - chat]);
  }, [panelOpen, maximized]);

  useEffect(() => {
    if (!panelOpen || !visible) {
      document.documentElement.style.removeProperty("--artifact-panel-w");
      return;
    }
    const el = artifactPanelRef.current;
    if (!el) return;

    let rafId = 0;
    let pendingWidth = 0;
    const flush = () => {
      rafId = 0;
      document.documentElement.style.setProperty("--artifact-panel-w", `${pendingWidth}px`);
    };

    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1].contentRect.width);
      if (w <= 0) return;
      pendingWidth = w;
      if (rafId === 0) rafId = requestAnimationFrame(flush);
    });
    ro.observe(el);
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      ro.disconnect();
      document.documentElement.style.removeProperty("--artifact-panel-w");
    };
  }, [panelOpen, visible]);

  const onArtifactsCollapse = () => {
    if (useArtifactsStore.getState().panelOpen) useArtifactsStore.getState().setPanelOpen(false);
  };

  const onChatCollapse = () => {
    const state = useArtifactsStore.getState();
    if (state.panelOpen && !state.maximized) state.toggleMaximized();
  };

  return (
    <div className="Workspace">
      <PanelGroup
        ref={groupRef}
        direction="horizontal"
        className="WorkspacePanels"
        data-panel-open={panelOpen}
        data-maximized={maximized}
        data-animating={animating || undefined}
      >
        <Panel
          id="chat"
          order={1}
          collapsible
          collapsedSize={0}
          defaultSize={initialChatSize}
          minSize={0}
          onCollapse={onChatCollapse}
        >
          <div className="ChatPane" data-has-messages={hasMessages}>
            <div className="ChatPane-top">
              {hasMessages && <MessageList />}
            </div>
            <div className="Composer-dock">
              {error && (
                <div className="ChatPane-error" role="alert">
                  <span>{error}</span>
                  <button
                    type="button"
                    className="ChatPane-errorClose"
                    aria-label="Dismiss error"
                    onClick={dismissError}
                  >
                    <VscClose />
                  </button>
                </div>
              )}
              <div className="Composer-wrapper">
                <InputBar promptMode={hasMessages} />
              </div>
            </div>
            <div className="ChatPane-bottomSpacer" />
          </div>
        </Panel>
        <PanelResizeHandle className="PanelResizeHandle" disabled={!panelOpen || maximized} />
        <Panel
          id="artifacts"
          order={2}
          collapsible
          collapsedSize={0}
          defaultSize={100 - initialChatSize}
          minSize={0}
          onCollapse={onArtifactsCollapse}
        >
          <div ref={artifactPanelRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <ArtifactPanel visible={visible} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
