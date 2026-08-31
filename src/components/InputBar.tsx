import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VscAdd,
  VscArrowUp,
  VscDebugStop,
  VscFile,
  VscFileMedia,
  VscFolderOpened,
  VscMic,
} from "react-icons/vsc";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { renderToStaticMarkup } from "react-dom/server";
import { useDebouncedCallback } from "use-debounce";
import * as api from "../lib/api";
import { useChatStore } from "../lib/store";
import { useWorkspaceStore } from "../lib/workspace";
import { useArtifactsStore } from "../lib/artifacts";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { AttachmentCard, ExplorerIcon } from "./ChatPrimitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

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

function createMentionNode(path: string): { node: HTMLSpanElement; space: Text } {
  const filename = api.getBasename(path) || path;
  const container = document.createElement("span");
  container.className = "FileTag FileTag-clickable";
  container.contentEditable = "false";
  container.setAttribute("data-path", path);
  container.title = path;
  container.insertAdjacentHTML(
    "beforeend",
    renderToStaticMarkup(
      <ExplorerIcon
        type="file"
        name={filename}
        className="FileTag-icon"
        width={14}
        height={14}
        aria-hidden="true"
      />
    )
  );
  const name = document.createElement("span");
  name.className = "FileTag-name";
  name.textContent = filename;
  container.append(name);
  const space = document.createTextNode("\u00A0");
  return { node: container, space };
}

function getTextFromEditor(el: HTMLElement): string {
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.hasAttribute("data-path")) {
        const path = element.getAttribute("data-path") || "";
        text += path.includes(" ") ? `@[${path}] ` : `@${path} `;
      } else if (element.tagName === "BR") {
        text += "\n";
      } else if (element.tagName === "DIV" || element.tagName === "P") {
        const inner = getTextFromEditor(element);
        text += (text.length > 0 && !text.endsWith("\n") ? "\n" : "") + inner;
      } else {
        text += getTextFromEditor(element);
      }
    }
  }
  return text;
}

function insertTextAtCaret(text: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertMentionAtCaret(path: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  let node: Node = range.startContainer;
  let offset = range.startOffset;

  if (node.nodeType !== Node.TEXT_NODE && node.childNodes.length > 0 && offset > 0) {
    const prev = node.childNodes[offset - 1];
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      node = prev;
      offset = (prev as Text).nodeValue?.length || 0;
    }
  }

  const { node: mentionNode, space: spaceNode } = createMentionNode(path);

  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    const str = textNode.nodeValue || "";
    const before = str.slice(0, offset);
    const after = str.slice(offset);
    const atIndex = before.lastIndexOf("@");
    if (atIndex !== -1) {
      textNode.nodeValue = before.slice(0, atIndex);
      const parent = textNode.parentNode;
      if (parent) {
        const next = textNode.nextSibling;
        parent.insertBefore(mentionNode, next);
        parent.insertBefore(spaceNode, next);
        if (after) parent.insertBefore(document.createTextNode(after), next);
        const newRange = document.createRange();
        newRange.setStart(spaceNode, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        return;
      }
    }
  }

  range.deleteContents();
  range.insertNode(spaceNode);
  range.insertNode(mentionNode);
  range.setStartAfter(spaceNode);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

interface ModelSelectorProps {
  models: api.ModelDto[];
  selectedModel: api.ModelDto | null;
  setSelectedModel: (key: string) => void;
  align?: "start" | "end";
}

function ModelSelector({ models, selectedModel, setSelectedModel, align = "start" }: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <Tooltip content="Select AI model" side="top">
        <DropdownMenuTrigger asChild>
          <Button className="Composer-model">
            <span>{selectedModel?.name ?? "Model"}</span>
            {selectedModel?.badge && <span className="Composer-badge">{selectedModel.badge}</span>}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} align={align}>
        {models.length === 0 && <DropdownMenuItem disabled>No models available</DropdownMenuItem>}
        {models.map((model) => (
          <DropdownMenuItem key={model.key} onSelect={() => setSelectedModel(model.key)}>
            <span className="ModelItem-name">{model.name}</span>
            {model.badge && <span className="Composer-badge">{model.badge}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorkspaceDisplayProps {
  currentName: string | undefined;
  currentPath?: string;
}

function WorkspaceDisplay({ currentName, currentPath }: WorkspaceDisplayProps) {
  return (
    <Tooltip content={currentPath ? `Workspace: ${currentPath}` : "Current workspace"} side="top">
      <div className="Composer-repo">
        <VscFolderOpened />
        <span>{currentName ?? "Workspace"}</span>
      </div>
    </Tooltip>
  );
}

export function InputBar({ promptMode = false }: { promptMode?: boolean }) {
  const send             = useChatStore((s) => s.send);
  const cancel           = useChatStore((s) => s.cancel);
  const streaming        = useChatStore((s) => s.streaming);
  const models           = useChatStore((s) => s.models);
  const selectedModel    = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const newChat          = useChatStore((s) => s.newChat);
  const sessionTokens    = useChatStore((s) => s.sessionTokens);
  const openFile         = useArtifactsStore((s) => s.openFile);

  const currentWs = useWorkspaceStore((s) => s.current);

  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<api.AttachmentRef[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [query, setQuery] = useState("");
  const [fileHits, setFileHits] = useState<api.FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);

  const maxContext = selectedModel?.contextWindow ?? 0;
  const fillPct =
    maxContext > 0
      ? Math.min(100, Math.max(0, Math.round((sessionTokens.totalTokens / maxContext) * 100)))
      : 0;
  const modelSupportsImages = selectedModel?.capabilities.includes("images") ?? false;

  const addAttachments = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const rejected: string[] = [];
      setAttachments((previous) => {
        const known = new Set(previous.map((a) => a.path));
        const next = [...previous];
        for (const path of paths) {
          if (known.has(path)) continue;
          const image = api.isImagePath(path);
          if (image && !modelSupportsImages) {
            rejected.push(api.getBasename(path));
            continue;
          }
          known.add(path);
          next.push({ path, name: api.getBasename(path), isImage: image });
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
      .then((fn) => { unlisten = fn; });
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
      searchFiles.cancel();
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

  const syncEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = getTextFromEditor(editor);
    if (!text.trim() && !editor.querySelector("[data-path]")) {
      if (editor.innerHTML !== "") editor.innerHTML = "";
    }
    setValue(text);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      setTrigger(null);
      setQuery("");
      return;
    }

    try {
      const range = sel.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(editor);
      preRange.setEnd(range.endContainer, range.endOffset);
      const preText = getTextFromEditor(preRange.cloneContents() as unknown as HTMLElement);
      const token = activeToken(text, preText.length);
      setTrigger(token.trigger);
      setQuery(token.query);
      setHighlighted(0);
    } catch {
      setTrigger(null);
      setQuery("");
    }
  }, []);

  const insertMention = useCallback(
    (filePath: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      insertMentionAtCaret(filePath);
      closePopover();
      syncEditor();
      editor.focus();
    },
    [closePopover, syncEditor]
  );

  const runCommand = useCallback(
    (command: CommandItem) => {
      if (command.key === "clear") {
        newChat();
        if (editorRef.current) editorRef.current.innerHTML = "";
        setValue("");
        setAttachments([]);
        setNotice(null);
      }
      closePopover();
    },
    [newChat, closePopover]
  );

  const doSend = useCallback(async () => {
    const editor = editorRef.current;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    const pending = attachments;
    if (editor) editor.innerHTML = "";
    setValue("");
    setAttachments([]);
    setNotice(null);
    closePopover();
    const ok = await send(text, pending);
    if (!ok) {
      if (editor) editor.innerText = text;
      setValue(text);
      setAttachments(pending);
    }
  }, [value, attachments, send, closePopover]);

  const popoverOpen = trigger !== null;
  const hits: (api.FileEntry | CommandItem)[] = trigger === "@" ? fileHits : commandHits;
  const activeIndex = hits.length === 0 ? 0 : Math.min(highlighted, hits.length - 1);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
          if (trigger === "@") insertMention((hit as api.FileEntry).path);
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

  const onEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const mentionEl = target.closest<HTMLElement>("[data-path]");
    if (mentionEl) {
      const path = mentionEl.getAttribute("data-path");
      if (path) { openFile(path); return; }
    }
    syncEditor();
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    insertTextAtCaret(text);
    syncEditor();
  };

  const toggleDictation = useCallback(async () => {
    if (recording) {
      setRecording(false);
      try {
        await api.stopDictation();
      } catch (e) {
        console.error("Failed to stop dictation:", e);
      }
      return;
    }
    setRecording(true);
    setNotice(null);
    try {
      await api.startDictation((event) => {
        setRecording(false);
        if (event.type === "final") {
          if (event.text && editorRef.current) {
            insertTextAtCaret(event.text);
            syncEditor();
          }
        } else {
          setNotice(event.message);
        }
      });
    } catch (e) {
      setRecording(false);
      setNotice(api.errorMessage(e));
    }
  }, [recording, syncEditor]);

  const pickFiles = useCallback(
    async (imagesOnly: boolean) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: imagesOnly
          ? [{ name: "Images", extensions: [...api.IMAGE_EXTENSIONS] }]
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
                const filename = api.getBasename(file.path) || file.name;
                const dir = api.getDirname(file.path);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    key={file.path}
                    className="MentionItem"
                    data-active={index === activeIndex}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => insertMention(file.path)}
                  >
                    <ExplorerIcon type="file" name={filename} className="MentionItem-icon" width={14} height={14} />
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

        <div className={promptMode ? "Composer-inputArea Composer-inputArea-prompt" : "Composer-inputArea"}>
          <div
            ref={editorRef}
            className={promptMode ? "Composer-input Composer-input-prompt" : "Composer-input"}
            contentEditable
            role="textbox"
            aria-multiline="true"
            data-placeholder={promptMode ? "Write a message..." : "Ask anything, @ to mention a file, / for actions"}
            data-empty={value.length === 0 ? "true" : undefined}
            onInput={syncEditor}
            onKeyDown={onKeyDown}
            onClick={onEditorClick}
            onPaste={onPaste}
          />

          <div className={promptMode ? "Composer-row Composer-row-prompt" : "Composer-row"}>
            <DropdownMenu>
              <Tooltip content="Add files or images" side="top">
                <DropdownMenuTrigger asChild>
                  <Button className="Composer-plus" aria-label="Add attachment">
                    <VscAdd />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent sideOffset={6} align="start">
                <DropdownMenuItem
                  disabled={!modelSupportsImages}
                  onSelect={() => { if (modelSupportsImages) void pickFiles(true); }}
                >
                  <VscFileMedia />
                  <span>Image</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pickFiles(false)}>
                  <VscFile />
                  <span>File</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {!promptMode && (
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
              />
            )}

            <span className="Composer-rowspacer" />

            {maxContext > 0 && (
              <Tooltip
                content={`Context: ${sessionTokens.totalTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens (${fillPct}%)`}
                side="top"
              >
                <div className="TokenRing">
                  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                    <circle cx="11" cy="11" r="8.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
                    <circle
                      cx="11" cy="11" r="8.5" fill="none"
                      stroke={fillPct > 85 ? "#FC6B83" : fillPct > 60 ? "#F1B467" : "#CCCCCC"}
                      strokeWidth="2.5"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * fillPct) / 100}
                      strokeLinecap="round"
                      transform="rotate(-90 11 11)"
                    />
                  </svg>
                  <span className="TokenRing-label">{fillPct}%</span>
                </div>
              </Tooltip>
            )}

            <Tooltip
              content={
                recording
                  ? "Stop dictation"
                  : canSend
                  ? streaming
                    ? "Stop generating"
                    : "Send message (Enter)"
                  : "Voice dictation"
              }
              side="top"
            >
              <Button
                className={`Composer-send${streaming ? " Composer-stop" : recording ? " Composer-mic-send" : !canSend ? " Composer-mic-idle" : ""}`}
                aria-label={
                  recording
                    ? "Stop dictation"
                    : canSend
                    ? streaming
                      ? "Stop generating"
                      : "Send message"
                    : "Start voice dictation"
                }
                onClick={() => {
                  if (streaming) { cancel(); return; }
                  if (recording) { void toggleDictation(); return; }
                  if (canSend) { void doSend(); return; }
                  void toggleDictation();
                }}
              >
                {streaming ? (
                  <VscDebugStop />
                ) : recording ? (
                  <span className="Composer-micWaves" aria-hidden="true">
                    <span /><span /><span /><span />
                  </span>
                ) : canSend ? (
                  <VscArrowUp />
                ) : (
                  <VscMic />
                )}
              </Button>
            </Tooltip>
          </div>
        </div>

        {!promptMode && (
          <div className="Composer-subrow">
            <WorkspaceDisplay
              currentName={currentWs?.name}
              currentPath={currentWs?.path}
            />
          </div>
        )}
      </div>

      {promptMode && (
        <div className="Composer-footer">
          <WorkspaceDisplay
            currentName={currentWs?.name}
            currentPath={currentWs?.path}
          />
          <ModelSelector
            models={models}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            align="end"
          />
        </div>
      )}
    </div>
  );
}
