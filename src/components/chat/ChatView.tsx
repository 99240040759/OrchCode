import { LuX } from "react-icons/lu";
import { useAuthStore } from "../../lib/auth";
import { useChatStore } from "../../lib/store";
import { IconButton } from "../ui/Button";
import { Composer } from "../composer/Composer";
import { MessageList } from "./MessageList";

function Home() {
  const name = useAuthStore((s) => s.user?.displayName?.split(" ")[0]);
  return (
    <div className="chat-home">
      <img src="/icon.png" alt="" />
      <h1>{name ? `Welcome back, ${name}. Where should we pick up?` : "Where should we pick up?"}</h1>
    </div>
  );
}

export function ChatView() {
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const sessionId = useChatStore((s) => s.currentSessionId);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);

  return (
    <div className="chat">
      {hasMessages ? <MessageList key={sessionId} /> : <Home />}
      <div className="dock">
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <IconButton label="Dismiss" size="sm" onClick={dismissError}>
              <LuX />
            </IconButton>
          </div>
        )}
        <Composer home={!hasMessages} />
      </div>
    </div>
  );
}
