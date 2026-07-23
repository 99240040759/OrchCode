import { useEffect, useRef } from "react";
import { useChatStore } from "../lib/store";
import { Message } from "./Message";
import { ThinkingShimmer } from "./ThinkingShimmer";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (isNearBottomRef.current) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    }
  });

  return (
    <div className="MessageList" ref={containerRef} onScroll={handleScroll}>
      <div className="MessageList-inner">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {streaming && messages.length === 0 && <ThinkingShimmer />}
        <div ref={endRef} className="MessageList-bottomSpacer" />
      </div>
    </div>
  );
}
