import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowDown } from "react-icons/fi";
import { useChatStore } from "../lib/store";
import { Message } from "./Message";

const NEAR_BOTTOM_PX = 120;

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <div className="MessageListWrap">
      <div className="MessageList" ref={containerRef} onScroll={handleScroll}>
        <div className="MessageList-inner">
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          <div className="MessageList-bottomSpacer" />
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
