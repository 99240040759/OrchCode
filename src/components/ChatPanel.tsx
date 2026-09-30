import { useEffect, useRef } from "react";
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

export function ChatPanel() {
  const hasMessages  = useChatStore((s) => s.messages.length > 0);
  const error        = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const panelOpen    = useArtifactsStore((s) => s.panelOpen);
  const maximized    = useArtifactsStore((s) => s.maximized);

  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const initialChatSize = useRef(chatSizeFor(panelOpen, maximized)).current;

  useEffect(() => {
    const chat = chatSizeFor(panelOpen, maximized);
    groupRef.current?.setLayout([chat, 100 - chat]);
  }, [panelOpen, maximized]);

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
          <div className="ChatPane">
            {hasMessages && <MessageList />}
            <div className={hasMessages ? "Composer-dock" : "EmptyState"}>
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
          <ArtifactPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
