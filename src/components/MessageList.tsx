import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { VscArrowDown } from "react-icons/vsc";
import { useChatStore } from "../lib/store";
import { Message } from "./Message";

const NEAR_BOTTOM_PX = 100;

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const loadingEarlier = useChatStore((s) => s.loadingEarlierMessages);
  const loadEarlier = useChatStore((s) => s.loadEarlierMessages);

  const containerRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const pinnedRef = useRef(true);
  const lastCountRef = useRef(0);
  const prevScrollHeightRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    pinnedRef.current = pinned;
    setShowJump((prev) => (prev === !pinned ? prev : !pinned));
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || messages.length === 0) return;

    const countDelta = messages.length - lastCountRef.current;
    lastCountRef.current = messages.length;

    if (countDelta > 0 && !pinnedRef.current && prevScrollHeightRef.current > 0) {
      const heightDelta = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop += heightDelta;
      prevScrollHeightRef.current = 0;
      return;
    }

    const lastIsUser =
      messages[messages.length - 1]?.role === "user" ||
      messages[messages.length - 2]?.role === "user";
    if (countDelta > 0 && lastIsUser && streaming) {
      el.scrollTop = el.scrollHeight;
      pinnedRef.current = true;
      setShowJump(false);
      return;
    }

    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else if (streaming) {
      setShowJump(true);
    }
  }, [messages, streaming]);

  return (
    <div className="MessageListWrap">
      <div
        className="MessageList"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div className="MessageList-inner">
          {hasMoreMessages && (
            <div className="MessageList-earlierWrap">
              <button
                type="button"
                className="MessageList-loadEarlier"
                disabled={loadingEarlier}
                onClick={() => {
                  if (containerRef.current) {
                    prevScrollHeightRef.current = containerRef.current.scrollHeight;
                  }
                  void loadEarlier();
                }}
              >
                {loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
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
