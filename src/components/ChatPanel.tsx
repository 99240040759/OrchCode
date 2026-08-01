import { useEffect, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useArtifactsStore } from "../lib/artifacts";
import { useChatStore } from "../lib/store";
import { ArtifactPanel } from "./ArtifactPanel";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";

export function ChatPanel() {
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);

  const chatRef = useRef<ImperativePanelHandle>(null);
  const artifactRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    const chat = chatRef.current;
    const artifact = artifactRef.current;
    if (!chat || !artifact) return;

    if (!panelOpen) {
      artifact.collapse();
      chat.expand();
      return;
    }

    artifact.expand();
    if (maximized) chat.collapse();
    else chat.expand();
  }, [panelOpen, maximized]);

  return (
    <div className="Workspace">
      <PanelGroup
        direction="horizontal"
        className="WorkspacePanels"
        data-panel-open={panelOpen}
        data-maximized={maximized}
      >
        <Panel
          id="chat"
          order={1}
          ref={chatRef}
          collapsible
          collapsedSize={0}
          defaultSize={60}
          minSize={25}
        >
          <div className="ChatPane">
            {hasMessages && <MessageList />}
            <div className={hasMessages ? "Composer-dock" : "EmptyState"}>
              <div className="Composer-wrapper">
                <InputBar />
              </div>
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="PanelResizeHandle" />
        <Panel
          id="artifacts"
          order={2}
          ref={artifactRef}
          collapsible
          collapsedSize={0}
          defaultSize={40}
          minSize={25}
        >
          <ArtifactPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}

export default ChatPanel;
