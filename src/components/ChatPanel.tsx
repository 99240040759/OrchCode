import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { InputBar } from "./InputBar";
import { ArtifactPanel } from "./ArtifactPanel";
import { MessageList } from "./MessageList";
import { useChatStore } from "../lib/store";
import { useArtifactsStore } from "../lib/artifacts";

export function ChatPanel() {
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const streaming = useChatStore((s) => s.streaming);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);
  const showMessageList = hasMessages || streaming;

  const chatContent = (
    <div className="ChatPane">
      {showMessageList && <MessageList />}
      <div className={showMessageList ? "Composer-dock" : "EmptyState"}>
        <div className="Composer-wrapper">
          <InputBar />
        </div>
      </div>
    </div>
  );

  if (!panelOpen) return <div className="Workspace">{chatContent}</div>;
  if (maximized) return <div className="Workspace"><ArtifactPanel /></div>;

  return (
    <div className="Workspace">
      <PanelGroup direction="horizontal" className="WorkspacePanels">
        <Panel defaultSize={40} minSize={20}>
          {chatContent}
        </Panel>
        <PanelResizeHandle className="PanelResizeHandle" />
        <Panel defaultSize={60} minSize={25}>
          <ArtifactPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
