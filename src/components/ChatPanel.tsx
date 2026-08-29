import { useEffect, useRef } from "react";
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

export function ChatPanel() {
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const panelOpen   = useArtifactsStore((s) => s.panelOpen);
  const maximized   = useArtifactsStore((s) => s.maximized);

  const groupRef = useRef<ImperativePanelGroupHandle>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    if (!panelOpen) {
      group.setLayout([100, 0]);
      return;
    }

    if (maximized) {
      group.setLayout([0, 100]);
    } else {
      group.setLayout([60, 40]);
    }
  }, [panelOpen, maximized]);

  return (
    <div className="Workspace">
      <PanelGroup
        ref={groupRef}
        direction="horizontal"
        className="WorkspacePanels"
        data-panel-open={panelOpen}
        data-maximized={maximized}
      >
        <Panel id="chat" order={1} collapsible collapsedSize={0} defaultSize={60} minSize={0}>
          <div className="ChatPane">
            {hasMessages && <MessageList />}
            <div className={hasMessages ? "Composer-dock" : "EmptyState"}>
              <div className="Composer-wrapper">
                <InputBar promptMode={hasMessages} />
              </div>
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="PanelResizeHandle" />
        <Panel id="artifacts" order={2} collapsible collapsedSize={0} defaultSize={40} minSize={0}>
          <ArtifactPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
