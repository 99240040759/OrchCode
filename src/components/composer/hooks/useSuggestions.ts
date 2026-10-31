import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useDebouncedCallback } from "use-debounce";
import * as api from "../../../lib/api";
import { COMMANDS, type ActiveToken, type CommandItem, type Trigger } from "../types";

export function useSuggestions({
  onInsertMention,
  onRunCommand,
}: {
  onInsertMention: (filePath: string) => void;
  onRunCommand: (command: CommandItem) => void;
}) {
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [query, setQuery] = useState("");
  const [fileHits, setFileHits] = useState<api.FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const searchSeqRef = useRef(0);
  const tokenRangeRef = useRef<{ from: number; to: number } | null>(null);

  const searchFiles = useDebouncedCallback(async (text: string) => {
    const seq = ++searchSeqRef.current;
    setLoadingFiles(true);
    try {
      const hits = await api.listWorkspaceFiles(text, 100);
      if (seq === searchSeqRef.current) setFileHits(hits);
    } catch {
      if (seq === searchSeqRef.current) setFileHits([]);
    } finally {
      if (seq === searchSeqRef.current) {
        setLoadingFiles(false);
        setHighlighted(0);
      }
    }
  }, 120);

  useEffect(() => {
    if (trigger !== "@") {
      searchFiles.cancel();
      searchSeqRef.current += 1;
      setFileHits([]);
      setLoadingFiles(false);
      return;
    }
    void searchFiles(query);
  }, [trigger, query, searchFiles]);

  const commandHits = useMemo(() => {
    const lower = query.toLowerCase();
    return COMMANDS.filter(
      (c) =>
        c.key.toLowerCase().includes(lower) ||
        c.label.toLowerCase().includes(lower)
    );
  }, [query]);

  const close = useCallback(() => {
    setTrigger(null);
    setQuery("");
    setFileHits([]);
    setLoadingFiles(false);
    setHighlighted(0);
    tokenRangeRef.current = null;
  }, []);

  const detectActiveToken = useCallback((ed: Editor): ActiveToken => {
    const { state } = ed;
    const { from } = state.selection;
    const blockStart = state.selection.$from.start();
    const textBefore = state.doc.textBetween(blockStart, from, "\n", "\0");

    const atMatch = /(^|\s)@([^\s]*)$/.exec(textBefore);
    if (atMatch) {
      const queryStr = atMatch[2];
      const matchLength = queryStr.length + 1;
      return {
        trigger: "@",
        query: queryStr,
        from: from - matchLength,
        to: from,
      };
    }

    const slashMatch = /^\s*\/([^\s]*)$/.exec(textBefore);
    if (slashMatch) {
      const queryStr = slashMatch[1];
      const matchLength = queryStr.length + 1;
      return {
        trigger: "/",
        query: queryStr,
        from: from - matchLength,
        to: from,
      };
    }

    return { trigger: null, query: "", from: 0, to: 0 };
  }, []);

  const checkToken = useCallback(
    (ed: Editor) => {
      const token = detectActiveToken(ed);
      if (token.trigger) {
        setTrigger((prev) => (prev === token.trigger ? prev : token.trigger));
        setQuery((prev) => (prev === token.query ? prev : token.query));
        tokenRangeRef.current = { from: token.from, to: token.to };
      } else {
        setTrigger((prev) => (prev === null ? prev : null));
        setQuery((prev) => (prev === "" ? prev : ""));
        tokenRangeRef.current = null;
      }
    },
    [detectActiveToken]
  );

  const hits = trigger === "@" ? fileHits : commandHits;
  const activeIndex = hits.length === 0 ? 0 : Math.min(highlighted, hits.length - 1);

  const stateRef = useRef({ hits, activeIndex, trigger, close, onInsertMention, onRunCommand });
  stateRef.current = { hits, activeIndex, trigger, close, onInsertMention, onRunCommand };

  const handleKeyDown = useCallback((event: React.KeyboardEvent | KeyboardEvent): boolean => {
    const current = stateRef.current;
    if (!current.trigger) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      current.close();
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((h) => (current.hits.length === 0 ? 0 : (h + 1) % current.hits.length));
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) =>
        current.hits.length === 0 ? 0 : (h - 1 + current.hits.length) % current.hits.length
      );
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      if (current.hits.length > 0) {
        event.preventDefault();
        const hit = current.hits[Math.min(current.activeIndex, current.hits.length - 1)];
        if (current.trigger === "@") {
          current.onInsertMention((hit as api.FileEntry).path);
        } else {
          current.onRunCommand(hit as CommandItem);
        }
        return true;
      }
    }

    return false;
  }, []);

  return {
    isOpen: trigger !== null,
    trigger,
    query,
    fileHits,
    commandHits,
    loadingFiles,
    activeIndex,
    tokenRangeRef,
    setHighlighted,
    checkToken,
    handleKeyDown,
    close,
  };
}
