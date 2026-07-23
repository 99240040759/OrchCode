import { useCallback, useEffect, useRef, useState } from "react";
import { FiChevronDown, FiMonitor, FiPlus, FiMic, FiArrowUp, FiSquare, FiX, FiFile, FiImage, FiCheck } from "react-icons/fi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDebouncedCallback } from "use-debounce";
import { useChatStore } from "../lib/store";
import * as api from "../lib/api";
import { getBasename, getDirname } from "../lib/utils";
import { Button } from "./ui/Button";
import ExplorerIcon from "./ExplorerIcon";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/DropdownMenu";

interface Attachment {
  path: string;
  name: string;
  isImage: boolean;
}

interface CommandItem {
  key: string;
  label: string;
  hint: string;
  action: "clear";
}

const COMMANDS: CommandItem[] = [
  { key: "clear", label: "Clear chat", hint: "Clear current conversation session and start a new one", action: "clear" },
];

const ATTACH_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|pdf)$/i;
const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

type Trigger = "@" | "/" | null;

function activeToken(text: string, caret: number) {
  const upto = text.slice(0, caret);
  const atMatch = /(^|\s)@([^\s]*)$/.exec(upto);
  if (atMatch) return { trigger: "@" as Trigger, query: atMatch[2], start: caret - atMatch[2].length - 1 };
  const slashMatch = /(^|\s)\/([^\s]*)$/.exec(upto);
  if (slashMatch) return { trigger: "/" as Trigger, query: slashMatch[2], start: caret - slashMatch[2].length - 1 };
  return { trigger: null as Trigger, query: "", start: caret };
}

function AttachmentCardItem({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImg = attachment.isImage;
  const imgSrc = isImg && api.inTauri() ? convertFileSrc(attachment.path) : `file://${attachment.path}`;

  if (isImg) {
    return (
      <div className="AttachmentCard AttachmentCard-image" title={attachment.path}>
        <div className="AttachmentCard-thumbWrap">
          <img src={imgSrc} alt={attachment.name} className="AttachmentCard-thumb" onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }} />
        </div>
        <span className="AttachmentCard-name">{attachment.name}</span>
        <button type="button" className="AttachmentCard-remove" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
          <FiX />
        </button>
      </div>
    );
  }

  return (
    <div className="AttachmentCard AttachmentCard-doc" title={attachment.path}>
      <ExplorerIcon type="file" name={attachment.name} className="AttachmentCard-icon" style={{ width: 15, height: 15, flexShrink: 0 }} />
      <span className="AttachmentCard-name">{attachment.name}</span>
      <button type="button" className="AttachmentCard-remove" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
        <FiX />
      </button>
    </div>
  );
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

  const maxContext = selectedModel?.contextWindow || 128000;
  const fillPct = Math.min(100, Math.max(0, Math.round((sessionTokens.totalTokens / maxContext) * 100)));

  const modelSupportsImages = selectedModel?.capabilities.includes("images") ?? false;

  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [query, setQuery] = useState("");
  const [tokenStart, setTokenStart] = useState(0);
  const [fileHits, setFileHits] = useState<api.FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [hi, setHi] = useState(0);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const dictBase = useRef<string>("");

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (!api.inTauri()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths ?? [];
        const next: Attachment[] = paths
          .filter((p) => ATTACH_EXTS.test(p))
          .map((p) => ({ path: p, name: getBasename(p), isImage: IMAGE_EXTS.test(p) }))
          .filter((a) => !a.isImage || modelSupportsImages);
        if (next.length) setAttachments((prev) => [...prev, ...next]);
      }
    }).then((un) => { unlisten = un; }).catch(() => { });
    return () => unlisten?.();
  }, [modelSupportsImages]);

  const searchFiles = useDebouncedCallback(async (q: string) => {
    if (!q && trigger !== "@") return;
    setLoadingFiles(true);
    try {
      const hits = await api.listWorkspaceFiles(q, 100);
      setFileHits(hits);
      setHi(0);
    } catch { setFileHits([]); } finally { setLoadingFiles(false); }
  }, 100);

  useEffect(() => {
    if (trigger !== "@") { setFileHits([]); setLoadingFiles(false); return; }
    void searchFiles(query);
  }, [trigger, query, searchFiles]);

  const commandHits = COMMANDS.filter((c) => c.key.toLowerCase().includes(query.toLowerCase()) || c.label?.toLowerCase().includes(query.toLowerCase()));

  const syncToken = useCallback((text: string, caret: number) => {
    const tok = activeToken(text, caret);
    setTrigger(tok.trigger);
    setQuery(tok.query);
    setTokenStart(tok.start);
    setHi(0);
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    syncToken(text, e.target.selectionStart ?? text.length);
  };

  const closePopover = useCallback(() => {
    setTrigger(null);
    setQuery("");
    setFileHits([]);
    setLoadingFiles(false);
  }, []);

  const applyMention = useCallback((insertText: string) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(caret);
    const next = `${before}${insertText}${after}`;
    setValue(next);
    closePopover();
    requestAnimationFrame(() => {
      const pos = (before + insertText).length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  }, [value, tokenStart, closePopover]);

  const pickFile = (path: string) => applyMention(`@${path} `);

  const pickCommand = (item: CommandItem) => {
    if (item.action === "clear") { newChat(); closePopover(); setValue(""); return; }
  };

  const doSend = useCallback(async () => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    const attachmentRefs = attachments.map((a) => ({ path: a.path, name: a.name, isImage: a.isImage }));
    setValue("");
    setAttachments([]);
    closePopover();
    void send(text, attachmentRefs.length ? attachmentRefs : undefined);
  }, [value, attachments, send, closePopover]);

  const popoverOpen = trigger !== null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popoverOpen) {
      const hits = trigger === "@" ? fileHits : commandHits;
      if (hits.length > 0) {
        if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % hits.length); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + hits.length) % hits.length); return; }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (trigger === "@") pickFile((hits[hi] as api.FileEntry).path);
          else pickCommand(hits[hi] as CommandItem);
          return;
        }
      }
      if (e.key === "Escape") { e.preventDefault(); closePopover(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void doSend();
    }
  };

  const toggleDictation = useCallback(async () => {
    if (recording) { setRecording(false); await api.stopDictation().catch(() => { }); return; }
    dictBase.current = value ? value.trimEnd() + " " : "";
    setRecording(true);
    try {
      await api.startDictation((e) => {
        if (e.type === "final") {
          setValue(dictBase.current + e.text);
          setRecording(false);
        } else if (e.type === "error") {
          setRecording(false);
        }
      });
    } catch { setRecording(false); }
  }, [recording, value]);

  const pickAttachments = useCallback(async (imagesOnly: boolean) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: imagesOnly
          ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }]
          : [{ name: "Documents", extensions: ["pdf", "txt", "md", "rs", "ts", "tsx", "js", "json", "py", "html", "css"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const next: Attachment[] = paths.map((p) => ({ path: p, name: getBasename(p), isImage: imagesOnly }));
      setAttachments((prev) => [...prev, ...next]);
    } catch { }
  }, []);

  const removeAttachment = (path: string) => setAttachments((prev) => prev.filter((a) => a.path !== path));

  return (
    <div className="Composer" data-streaming={streaming || undefined} data-recording={recording || undefined}>
      {popoverOpen && (
        <div className="MentionPopover">
          {trigger === "@" ? (
            loadingFiles ? (
              <div className="MentionItem MentionItem-empty">Searching workspace...</div>
            ) : fileHits.length === 0 ? (
              <div className="MentionItem MentionItem-empty">
                {workspace?.isSandbox ? "Open a folder to mention files" : query ? `No files matching "${query}"` : "No workspace files found"}
              </div>
            ) : (
              fileHits.map((f, i) => {
                const filename = getBasename(f.path) || f.name;
                const dir = getDirname(f.path);
                return (
                  <button key={f.path} className="MentionItem" data-active={i === hi} onMouseEnter={() => setHi(i)} onClick={() => pickFile(f.path)}>
                    <ExplorerIcon type="file" name={filename} className="MentionItem-icon" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <span className="MentionItem-name">{filename}</span>
                    {dir ? <span className="MentionItem-path">{dir}</span> : null}
                  </button>
                );
              })
            )
          ) : commandHits.length === 0 ? (
            <div className="MentionItem MentionItem-empty">No commands matching &ldquo;/{query}&rdquo;</div>
          ) : (
            commandHits.map((s, i) => (
              <button key={s.key} className="MentionItem" data-active={i === hi} onMouseEnter={() => setHi(i)} onClick={() => pickCommand(s)}>
                <span className="MentionItem-slash">/{s.key}</span>
                <span className="MentionItem-name">{s.label}</span>
                <span className="MentionItem-path">{s.hint}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="Composer-box">
        {attachments.length > 0 && (
          <div className="Composer-attachments">
            {attachments.map((a) => (
              <AttachmentCardItem key={a.path} attachment={a} onRemove={() => removeAttachment(a.path)} />
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          className="Composer-input"
          placeholder="Ask anything, @ to mention, / for actions"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onClick={(e) => syncToken(value, e.currentTarget.selectionStart ?? value.length)}
        />
        {recording && (
          <div className="Composer-recBadge" aria-live="polite">
            <span className="Composer-recDot" />
            <span className="Composer-recBars">
              <span /><span /><span /><span />
            </span>
            <span className="Composer-recLabel">Recording</span>
          </div>
        )}

        <div className="Composer-row">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-plus" aria-label="Add attachment"><FiPlus /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              <DropdownMenuItem
                disabled={!modelSupportsImages}
                title={modelSupportsImages ? undefined : `${selectedModel?.name ?? "This model"} has no vision capability`}
                onSelect={() => modelSupportsImages && void pickAttachments(true)}
              >
                <FiImage /><span>Image</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void pickAttachments(false)}><FiFile /><span>Document</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-model">
                <span>{selectedModel?.name ?? "Model"}</span>
                {selectedModel?.badge && <span className="Composer-badge">{selectedModel.badge}</span>}
                <FiChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              {models.length === 0 && <DropdownMenuItem disabled>No models</DropdownMenuItem>}
              {models.map((m) => {
                const isSelected = m.key === selectedModel?.key;
                return (
                  <DropdownMenuItem key={m.key} data-selected={isSelected} onSelect={() => void setSelectedModel(m.key)}>
                    {isSelected && <FiCheck className="DropdownItem-check" />}
                    <span className="ModelItem-name">{m.name}</span>
                    {m.badge && <span className="Composer-badge">{m.badge}</span>}
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
                  max={2}
                  step={1}
                  value={reasoningEffort === "low" ? 0 : reasoningEffort === "medium" ? 1 : 2}
                  onChange={(e) => {
                    const map = ["low", "medium", "high"] as const;
                    setReasoningEffort(map[Number(e.target.value)]);
                  }}
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

          <Button className="Composer-mic" aria-label="Dictate" data-active={recording} onClick={() => void toggleDictation()}>
            <FiMic />
          </Button>

          <div
            className="TokenRing"
            title={`Session Context: ${sessionTokens.totalTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens (${fillPct}%)`}
          >
            <svg width="22" height="22" viewBox="0 0 22 22">
              <circle cx="11" cy="11" r="8.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
              <circle
                cx="11"
                cy="11"
                r="8.5"
                fill="none"
                stroke={fillPct > 85 ? "#ff5252" : fillPct > 60 ? "#ffb74d" : "#bb86fc"}
                strokeWidth="2.5"
                strokeDasharray={53.4}
                strokeDashoffset={53.4 - (53.4 * fillPct) / 100}
                strokeLinecap="round"
                transform="rotate(-90 11 11)"
              />
            </svg>
            <span className="TokenRing-label">{fillPct}%</span>
          </div>

          {streaming ? (
            <Button className="Composer-send Composer-stop" aria-label="Stop" onClick={cancel}>
              <FiSquare />
            </Button>
          ) : (
            <Button className="Composer-send" aria-label="Send prompt" disabled={!value.trim() && attachments.length === 0} onClick={() => void doSend()}>
              <FiArrowUp />
            </Button>
          )}
        </div>

        <div className="Composer-subrow">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="Composer-repo">
                <FiMonitor />
                <span>{workspace?.name ?? "Local"}</span>
                <FiChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={6} align="start">
              <DropdownMenuItem onSelect={() => void pickWorkspace()}>Open Folder&hellip;</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void resetToSandbox()}>Use Sandbox</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
