import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { VscArrowDown } from "react-icons/vsc";
import { useChatStore } from "../lib/store";
import { Message } from "./Message";

const NEAR_BOTTOM_PX = 120;

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setShowJump(!pinned);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, []);

  useLayoutEffect(() => {
    if (streaming && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, messages.length, scrollToBottom, streaming]);

  return (
    <div className="MessageListWrap">
      <div 
        className="MessageList" 
        ref={containerRef} 
        onScroll={handleScroll}
        style={{ overflowAnchor: 'none' }}
      >
        <div className="MessageList-inner">
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          <div 
            ref={bottomRef} 
            className="MessageList-bottomSpacer" 
            style={{ overflowAnchor: 'auto' }}
          />
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="MessageList-jump"
          aria-label="Scroll to latest message"
          onClick={scrollToBottom}
        >
          <VscArrowDown />
        </button>
      )}
    </div>
  );
}

export default MessageList;
