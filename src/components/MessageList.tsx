import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FiArrowDown } from "react-icons/fi";
import { useChatStore } from "../lib/store";
import { Message } from "./Message";

const NEAR_BOTTOM_PX = 120;

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  }, []);

  useLayoutEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [messages, streaming]);

  return (
    <div className="MessageListWrap">
      <div className="MessageList" ref={containerRef} onScroll={handleScroll}>
        <div className="MessageList-inner">
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          <div ref={bottomRef} className="MessageList-bottomSpacer" />
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="MessageList-jump"
          aria-label="Scroll to latest message"
          onClick={scrollToBottom}
        >
          <FiArrowDown />
        </button>
      )}
    </div>
  );
}

export default MessageList;
