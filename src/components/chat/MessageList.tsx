import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { LuArrowDown } from "react-icons/lu";
import { useChatStore } from "../../lib/store";
import { Button } from "../ui/Button";
import { Message } from "./Message";

const NEAR_BOTTOM_PX = 100;

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const hasMore = useChatStore((s) => s.hasMoreMessages);
  const loadingEarlier = useChatStore((s) => s.loadingEarlierMessages);
  const loadEarlier = useChatStore((s) => s.loadEarlierMessages);

  const ref = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const pinned = useRef(true);
  const lastCount = useRef(0);
  const prevHeight = useRef(0);

  const scrollToBottom = useCallback(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    pinned.current = true;
    setShowJump(false);
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    pinned.current = atBottom;
    setShowJump((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || messages.length === 0) return;
    const delta = messages.length - lastCount.current;
    lastCount.current = messages.length;

    if (delta > 0 && !pinned.current && prevHeight.current > 0) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
      return;
    }
    const userJustSent =
      messages[messages.length - 1]?.role === "user" || messages[messages.length - 2]?.role === "user";
    if (delta > 0 && userJustSent && streaming) {
      el.scrollTop = el.scrollHeight;
      pinned.current = true;
      setShowJump(false);
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else if (streaming) setShowJump(true);
  }, [messages, streaming]);

  return (
    <div className="chat-body">
      <div className="chat-scroll" ref={ref} onScroll={onScroll}>
        <div className="chat-inner">
          {hasMore && (
            <div className="chat-more">
              <Button
                variant="subtle"
                size="sm"
                disabled={loadingEarlier}
                onClick={() => {
                  if (ref.current) prevHeight.current = ref.current.scrollHeight;
                  void loadEarlier();
                }}
              >
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </Button>
            </div>
          )}
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
        </div>
      </div>
      {showJump && (
        <button type="button" className="chat-jump" aria-label="Scroll to latest message" onClick={scrollToBottom}>
          <LuArrowDown />
        </button>
      )}
    </div>
  );
}
