import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiArrowUp,
  FiCheck,
  FiChevronDown,
  FiFile,
  FiImage,
  FiMic,
  FiMonitor,
  FiPlus,
  FiSquare,
} from "react-icons/fi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useDebouncedCallback } from "use-debounce";
import * as api from "../lib/api";
import { useChatStore, type ReasoningEffort } from "../lib/store";
import { getBasename, getDirname, isImagePath } from "../lib/utils";
import { Button } from "./ui/Button";
import AttachmentCard from "./AttachmentCard";
import ExplorerIcon from "./ExplorerIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

const TEXTAREA_MAX_HEIGHT = 200;
const EFFORT_LEVELS: ReasoningEffort[] = ["low", "medium", "high"];
const RING_CIRCUMFERENCE = 53.4;

interface CommandItem {
  key: string;
  label: string;
  hint: string;
}

const COMMANDS: CommandItem[] = [
  { key: "clear", label: "New chat", hint: "Start a fresh conversation" },
];

type Trigger = "@" | "/" | null;

function activeToken(text: string, caret: number) {
  const upto = text.slice(0, caret);
  const at = /(^|\s)@([^\s]*)$/.exec(upto);
  if (at) return { trigger: "@" as Trigger, query: at[2], start: caret - at[2].length - 1 };
  const slash = /(^|\s)\/([^\s]*)$/.exec(upto);
  if (slash) return { trigger: "/" as Trigger, query: slash[2], start: caret - slash[2].length - 1 };
  return { trigger: null as Trigger, query: "", start: caret };
}

export function InputBar() {
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const streaming = useChatStore((s) => s.streaming);
  const models = useChatStore((s) => s.models);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const reasoningEffort = useChatStore((s) => s.reasoningEffort);
  const setReasoningEffort = useChatStore((s) => s.setReasoningEffort);
  const workspace = useChatStore((s) => s.workspace);
  const pickWorkspace = useChatStore((s) => s.pickWorkspace);
  const resetToSandbox = useChatStore((s) => s.resetToSandbox);
  const newChat = useChatStore((s) => s.newChat);
  const sessionTokens = useChatStore((s) => s.sessionTokens);

  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<api.AttachmentRef[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [query, setQuery] = useState("");
  const [tokenStart, setTokenStart] = useState(0);
  const [fileHits, setFileHits] = useState<api.FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dictationBase = useRef("");

  const maxContext = selectedModel?.contextWindow ?? 0;
  const fillPct =
    maxContext > 0
      ? Math.min(100, Math.max(0, Math.round((sessionTokens.totalTokens / maxContext) * 100)))
      : 0;
  const modelSupportsImages = selectedModel?.capabilities.includes("images") ?? false;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [value, attachments.length]);

  const addAttachments = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const rejected: string[] = [];
      setAttachments((previous) => {
        const known = new Set(previous.map((a) => a.path));
        const next = [...previous];
        for (const path of paths) {
          if (known.has(path)) continue;
          const image = isImagePath(path);
          if (image && !modelSupportsImages) {
            rejected.push(getBasename(path));
            continue;
          }
          known.add(path);
          next.push({ path, name: getBasename(path), isImage: image });
        }
        return next;
      });
      setNotice(
        rejected.length > 0
          ? `${selectedModel?.name ?? "This model"} cannot read images: ${rejected.join(", ")}`
          : null
      );
    },
    [modelSupportsImages, selectedModel?.name]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        addAttachments(event.payload.paths ?? []);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [addAttachments]);

  const searchFiles = useDebouncedCallback(async (text: string) => {
    setLoadingFiles(true);
    try {
      const hits = await api.listWorkspaceFiles(text, 100);
      setFileHits(hits);
    } catch {
      setFileHits([]);
    } finally {
      setLoadingFiles(false);
      setHighlighted(0);
    }
  }, 120);

  useEffect(() => {
    if (trigger !== "@") {
      setFileHits([]);
      setLoadingFiles(false);
      return;
    }
    void searchFiles(query);
  }, [trigger, query, searchFiles]);

  const commandHits = useMemo(() => {
    const lower = query.toLowerCase();
    return COMMANDS.filter(
      (c) => c.key.toLowerCase().includes(lower) || c.label.toLowerCase().includes(lower)
    );
  }, [query]);

  const closePopover = useCallback(() => {
    setTrigger(null);
    setQuery("");
    setFileHits([]);
    setLoadingFiles(false);
    setHighlighted(0);
  }, []);

  const syncToken = useCallback((text: string, caret: number) => {
    const token = activeToken(text, caret);
    setTrigger(token.trigger);
    setQuery(token.query);
    setTokenStart(token.start);
    setHighlighted(0);
  }, []);

  const insertMention = useCallback(
    (insertText: string) => {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? value.length;
      const before = value.slice(0, tokenStart);
      const after = value.slice(caret);
      const next = `${before}${insertText}${after}`;
      setValue(next);
      closePopover();
      requestAnimationFrame(() => {
        const position = (before + insertText).length;
        el?.focus();
        el?.setSelectionRange(position, position);
      });
    },
    [value, tokenStart, closePopover]
  );

  const runCommand = useCallback(
    (command: CommandItem) => {
      if (command.key === "clear") {
        newChat();
        setValue("");
        setAttachments([]);
        setNotice(null);
      }
      closePopover();
    },
    [newChat, closePopover]
  );

  const doSend = useCallback(async () => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    const pending = attachments;
    setValue("");
    setAttachments([]);
    setNotice(null);
    closePopover();
    const ok = await send(text, pending);
    if (!ok) {
      setValue(value);
      setAttachments(pending);
    }
  }, [value, attachments, send, closePopover]);

  const popoverOpen = trigger !== null;
  const hits: (api.FileEntry | CommandItem)[] = trigger === "@" ? fileHits : commandHits;
  const activeIndex = hits.length === 0 ? 0 : Math.min(highlighted, hits.length - 1);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popoverOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover();
        return;
      }
      if (hits.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlighted((h) => (Math.min(h, hits.length - 1) + 1) % hits.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlighted((h) => (Math.min(h, hits.length - 1) - 1 + hits.length) % hits.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const hit = hits[activeIndex];
          if (trigger === "@") insertMention(`@${(hit as api.FileEntry).path} `);
          else runCommand(hit as CommandItem);
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void doSend();
    }
  };

  const toggleDictation = useCallback(async () => {
    if (recording) {
      setRecording(false);
      try {
        await api.stopDictation();
      } catch (e) {
        setNotice(api.errorMessage(e));
      }
      return;
    }
    dictationBase.current = value ? `${value.trimEnd()} ` : "";
    setRecording(true);
    setNotice(null);
    try {
      await api.startDictation((event) => {
        setRecording(false);
        if (event.type === "final") {
          if (event.text) setValue(dictationBase.current + event.text);
        } else {
          setNotice(event.message);
        }
      });
    } catch (e) {
      setRecording(false);
      setNotice(api.errorMessage(e));
    }
  }, [recording, value]);

  const pickFiles = useCallback(
    async (imagesOnly: boolean) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: imagesOnly
          ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] }]
          : undefined,
      });
      if (!selected) return;
      addAttachments(Array.isArray(selected) ? selected : [selected]);
    },
    [addAttachments]
  );

  const removeAttachment = (path: string) =>
    setAttachments((previous) => previous.filter((a) => a.path !== path));

  const canSend = value.trim().length > 0 || attachments.length > 0;

  return (
    <div
      className="Composer"
      data-streaming={streaming || undefined}
      data-recording={recording || undefined}
    >
      {popoverOpen && (
        <div className="MentionPopover" role="listbox">
          {trigger === "@" ? (
            loadingFiles ? (
              <div className="MentionItem MentionItem-empty">Searching workspace…</div>
            ) : fileHits.length === 0 ? (
              <div className="MentionItem MentionItem-empty">
                {query ? `No files matching "${query}"` : "No workspace files found"}
              </div>
            ) : (
              fileHits.map((file, index) => {
                const filename = getBasename(file.path) || file.name;
                const dir = getDirname(file.path);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    key={file.path}
                    className="MentionItem"
                    data-active={index === activeIndex}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => insertMention(`@${file.path} `)}
                  >
                    <ExplorerIcon
                      type="file"
                      name={filename}
                      className="MentionItem-icon"
                      width={14}
                      height={14}
                    />
                    <span className="MentionItem-name">{filename}</span>
                    {dir && <span className="MentionItem-path">{dir}</span>}
                  </button>
                );
              })
            )
          ) : commandHits.length === 0 ? (
            <div className="MentionItem MentionItem-empty">No matching actions</div>
          ) : (
            commandHits.map((command, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={command.key}
                className="MentionItem"
                data-active={index === activeIndex}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => runCommand(command)}
              >
                <span className="MentionItem-slash">/{command.key}</span>
                <span className="MentionItem-name">{command.label}</span>
                <span className="MentionItem-path">{command.hint}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="Composer-box">
        {attachments.length > 0 && (
          <div className="Composer-attachments">
            {attachments.map((attachment) => (
              <AttachmentCard
                key={attachment.path}
                name={attachment.name}
                isImage={attachment.isImage}
                path={attachment.path}
                onRemove={() => removeAttachment(attachment.path)}
              />
            ))}
          </div>
        )}

        {notice && (
          <div className="Composer-notice" role="status">
            {notice}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="Composer-input"
          placeholder="Ask anything, @ to mention a file, / for actions"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            syncToken(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onClick={(event) =>
            syncToken(value, event.currentTarget.selectionStart ?? value.length)
          }
        />

        {recording && (
          <div className="Composer-recBadge" aria-live="polite">
            <span className="Composer-recDot" />
            <span className="Composer-recBars">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className="Composer-recLabel">Recording</span>
          </div>
        )}

        <div className="Composer-row">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-plus" aria-label="Add attachment">
                <FiPlus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              <DropdownMenuItem
                disabled={!modelSupportsImages}
                onSelect={() => {
                  if (modelSupportsImages) void pickFiles(true);
                }}
              >
                <FiImage />
                <span>Image</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void pickFiles(false)}>
                <FiFile />
                <span>File</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-model">
                <span>{selectedModel?.name ?? "Model"}</span>
                {selectedModel?.badge && (
                  <span className="Composer-badge">{selectedModel.badge}</span>
                )}
                <FiChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              {models.length === 0 && <DropdownMenuItem disabled>No models available</DropdownMenuItem>}
              {models.map((model) => {
                const selected = model.key === selectedModel?.key;
                return (
                  <DropdownMenuItem
                    key={model.key}
                    data-selected={selected}
                    onSelect={() => setSelectedModel(model.key)}
                  >
                    {selected && <FiCheck className="DropdownItem-check" />}
                    <span className="ModelItem-name">{model.name}</span>
                    {model.badge && <span className="Composer-badge">{model.badge}</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-model" title={`Reasoning effort: ${reasoningEffort}`}>
                <span className="Composer-effort-label">{reasoningEffort}</span>
                <FiChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              <div className="EffortSliderPanel">
                <div className="EffortSliderPanel-header">
                  <span className="EffortSliderPanel-title">Reasoning effort</span>
                  <span className="EffortSliderPanel-value">{reasoningEffort}</span>
                </div>
                <input
                  type="range"
                  className="EffortSlider-input"
                  min={0}
                  max={EFFORT_LEVELS.length - 1}
                  step={1}
                  value={EFFORT_LEVELS.indexOf(reasoningEffort)}
                  onChange={(event) =>
                    setReasoningEffort(EFFORT_LEVELS[Number(event.target.value)])
                  }
                  aria-label="Reasoning effort"
                />
                <div className="EffortSliderPanel-ticks">
                  <span>Low</span>
                  <span>Med</span>
                  <span>High</span>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="Composer-rowspacer" />

          <Button
            className="Composer-mic"
            aria-label={recording ? "Stop dictation" : "Start dictation"}
            data-active={recording}
            onClick={() => void toggleDictation()}
          >
            <FiMic />
          </Button>

          {maxContext > 0 && (
            <div
              className="TokenRing"
              title={`Context: ${sessionTokens.totalTokens.toLocaleString()} of ${maxContext.toLocaleString()} tokens`}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                <circle
                  cx="11"
                  cy="11"
                  r="8.5"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="2.5"
                />
                <circle
                  cx="11"
                  cy="11"
                  r="8.5"
                  fill="none"
                  stroke={fillPct > 85 ? "#ff5252" : fillPct > 60 ? "#ffb74d" : "#bb86fc"}
                  strokeWidth="2.5"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * fillPct) / 100}
                  strokeLinecap="round"
                  transform="rotate(-90 11 11)"
                />
              </svg>
              <span className="TokenRing-label">{fillPct}%</span>
            </div>
          )}

          {streaming ? (
            <Button className="Composer-send Composer-stop" aria-label="Stop generating" onClick={cancel}>
              <FiSquare />
            </Button>
          ) : (
            <Button
              className="Composer-send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void doSend()}
            >
              <FiArrowUp />
            </Button>
          )}
        </div>

        <div className="Composer-subrow">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-repo">
                <FiMonitor />
                <span>{workspace?.name ?? "Workspace"}</span>
                <FiChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              <DropdownMenuItem onSelect={() => void pickWorkspace()}>
                Open folder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void resetToSandbox()}>
                Use sandbox
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export default InputBar;
