import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDebouncedCallback } from "use-debounce";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type Editor,
  type ReactNodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
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
interface CommandItem {
  key: string;
  label: string;
  hint: string;
}

const COMMANDS: CommandItem[] = [
  { key: "clear", label: "New chat", hint: "Start a fresh conversation" },
];

type Trigger = "@" | "/" | null;

interface ActiveToken {
  trigger: Trigger;
  query: string;
  from: number;
  to: number;
}

function MentionNodeView(props: ReactNodeViewProps) {
  const path = (props.node.attrs.id as string) || "";
  const name =
    (props.node.attrs.label as string) || api.getBasename(path) || path;
  const openFile = useArtifactsStore((s) => s.openFile);

  return (
    <NodeViewWrapper
      as="span"
      className="FileTag FileTag-clickable"
      data-path={path}
      title={path}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (path) openFile(path);
      }}
    >
      <ExplorerIcon
        type="file"
        name={name}
        className="FileTag-icon"
        width={14}
        height={14}
        aria-hidden="true"
      />
      <span className="FileTag-name">{name}</span>
    </NodeViewWrapper>
  );
}

const FileMention = Mention.extend({
  name: "mention",
  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
});

function extractPromptFromDoc(doc: any): string {
  let text = "";
  doc.descendants((node: any) => {
    if (node.type.name === "mention") {
      const path = node.attrs.id || "";
      text += `@[${path}] `;
      return false;
    }
    if (node.isText) {
      text += node.text;
    } else if (node.type.name === "hardBreak") {
      text += "\n";
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  });
  return text;
}

interface ModelSelectorProps {
  models: api.ModelDto[];
  selectedModel: api.ModelDto | null;
  setSelectedModel: (key: string) => void;
  align?: "start" | "end";
}

function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  align = "start",
}: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <Tooltip content="Select AI model" side="top">
        <DropdownMenuTrigger asChild>
          <Button className="Composer-model">
            <span>{selectedModel?.name ?? "Model"}</span>
            {selectedModel?.badge && (
              <span className="Composer-badge">{selectedModel.badge}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} align={align}>
        {models.length === 0 && (
          <DropdownMenuItem disabled>No models available</DropdownMenuItem>
        )}
        {models.map((model) => (
          <DropdownMenuItem
            key={model.key}
            onSelect={() => setSelectedModel(model.key)}
          >
            <span className="ModelItem-name">{model.name}</span>
            {model.badge && (
              <span className="Composer-badge">{model.badge}</span>
            )}
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
    <Tooltip
      content={currentPath ? `Workspace: ${currentPath}` : "Current workspace"}
      side="top"
    >
      <div className="Composer-repo">
        <VscFolderOpened />
        <span>{currentName ?? "Workspace"}</span>
      </div>
    </Tooltip>
  );
}

interface ContextBarProps {
  maxContext: number;
  contextTokens: number;
  fillPct: number;
}

function ContextBar({ maxContext, contextTokens, fillPct }: ContextBarProps) {
  const level = fillPct > 85 ? "danger" : fillPct > 60 ? "warn" : "normal";
  return (
    <Tooltip
      content={`Context Window: ${contextTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens (${fillPct}%)`}
      side="top"
    >
      <div className="ContextBar" data-level={level}>
        <div className="ContextBar-track">
          <div className="ContextBar-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <span className="ContextBar-label">{fillPct}%</span>
      </div>
    </Tooltip>
  );
}

export function InputBar({ promptMode = false }: { promptMode?: boolean }) {
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const streaming = useChatStore((s) => s.streaming);
  const models = useChatStore((s) => s.models);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const newChat = useChatStore((s) => s.newChat);
  const sessionTokens = useChatStore((s) => s.sessionTokens);

  const currentWs = useWorkspaceStore((s) => s.current);

  const [attachments, setAttachments] = useState<api.AttachmentRef[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [query, setQuery] = useState("");
  const [fileHits, setFileHits] = useState<api.FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [hasContent, setHasContent] = useState(false);

  const searchSeqRef = useRef(0);
  const tokenRangeRef = useRef<{ from: number; to: number } | null>(null);

  const maxContext = selectedModel?.contextWindow || 262144;
  const fillPct = Math.min(
    100,
    Math.max(0, Math.round((sessionTokens.contextTokens / maxContext) * 100))
  );
  const modelSupportsImages =
    selectedModel?.capabilities.includes("images") ?? false;

  const addAttachments = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const rejected = paths
        .filter((path) => api.isImagePath(path) && !modelSupportsImages)
        .map((path) => api.getBasename(path));
      const accepted = paths.filter(
        (path) => !(api.isImagePath(path) && !modelSupportsImages)
      );
      setAttachments((previous) => {
        const known = new Set(previous.map((a) => a.path));
        const next = [...previous];
        for (const path of accepted) {
          if (known.has(path)) continue;
          known.add(path);
          next.push({
            path,
            name: api.getBasename(path),
            isImage: api.isImagePath(path),
          });
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

  const closePopover = useCallback(() => {
    setTrigger(null);
    setQuery("");
    setFileHits([]);
    setLoadingFiles(false);
    setHighlighted(0);
    tokenRangeRef.current = null;
  }, []);

  const detectActiveToken = useCallback(
    (ed: Editor): ActiveToken => {
      const { state } = ed;
      const { from } = state.selection;
      const blockStart = state.selection.$from.start();
      const textBefore = state.doc.textBetween(blockStart, from, "\n", "\0");

      const atMatch = /(^|\s)@([^\s]*)$/.exec(textBefore);
      if (atMatch) {
        const queryStr = atMatch[2];
        const matchLength = queryStr.length + 1; // +1 for '@'
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
        const matchLength = queryStr.length + 1; // +1 for '/'
        return {
          trigger: "/",
          query: queryStr,
          from: from - matchLength,
          to: from,
        };
      }

      return { trigger: null, query: "", from: 0, to: 0 };
    },
    []
  );

  const popoverOpen = trigger !== null;
  const hits: (api.FileEntry | CommandItem)[] =
    trigger === "@" ? fileHits : commandHits;
  const activeIndex =
    hits.length === 0 ? 0 : Math.min(highlighted, hits.length - 1);

  // References to keep event handlers fresh without re-binding Tiptap
  const popoverOpenRef = useRef(popoverOpen);
  popoverOpenRef.current = popoverOpen;
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const closePopoverRef = useRef(closePopover);
  closePopoverRef.current = closePopover;

  const insertMentionRef = useRef<(filePath: string) => void>(() => {});
  const runCommandRef = useRef<(command: CommandItem) => void>(() => {});
  const doSendRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const toggleDictationRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const placeholderText = promptMode
    ? "Write a message..."
    : "Ask anything, @ to mention a file, / for actions";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({
        placeholder: placeholderText,
        emptyEditorClass: "is-editor-empty",
      }),
      FileMention,
    ],
    editorProps: {
      attributes: {
        class: promptMode
          ? "Composer-input Composer-input-prompt"
          : "Composer-input",
        "data-placeholder": placeholderText,
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229)
          return false;

        if (popoverOpenRef.current) {
          if (event.key === "Escape") {
            event.preventDefault();
            closePopoverRef.current();
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((h) => {
              const count = hitsRef.current.length;
              return count === 0 ? 0 : (h + 1) % count;
            });
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((h) => {
              const count = hitsRef.current.length;
              return count === 0 ? 0 : (h - 1 + count) % count;
            });
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const currentHits = hitsRef.current;
            if (currentHits.length > 0) {
              event.preventDefault();
              const hit =
                currentHits[
                  Math.min(activeIndexRef.current, currentHits.length - 1)
                ];
              if (triggerRef.current === "@") {
                insertMentionRef.current((hit as api.FileEntry).path);
              } else {
                runCommandRef.current(hit as CommandItem);
              }
              return true;
            }
          }
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (recordingRef.current) {
            void toggleDictationRef.current();
          }
          void doSendRef.current();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const prompt = extractPromptFromDoc(ed.state.doc);
      setHasContent(prompt.trim().length > 0);

      const token = detectActiveToken(ed);
      if (token.trigger) {
        setTrigger(token.trigger);
        setQuery(token.query);
        tokenRangeRef.current = { from: token.from, to: token.to };
        setHighlighted(0);
      } else {
        setTrigger(null);
        setQuery("");
        tokenRangeRef.current = null;
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const token = detectActiveToken(ed);
      if (token.trigger) {
        setTrigger(token.trigger);
        setQuery(token.query);
        tokenRangeRef.current = { from: token.from, to: token.to };
      } else {
        setTrigger(null);
        setQuery("");
        tokenRangeRef.current = null;
      }
    },
  });

  const insertMention = useCallback(
    (filePath: string) => {
      if (!editor) return;
      const filename = api.getBasename(filePath) || filePath;
      const range = tokenRangeRef.current;
      if (range) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: range.from, to: range.to })
          .insertContent([
            {
              type: "mention",
              attrs: { id: filePath, label: filename },
            },
            {
              type: "text",
              text: " ",
            },
          ])
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: "mention",
              attrs: { id: filePath, label: filename },
            },
            {
              type: "text",
              text: " ",
            },
          ])
          .run();
      }
      closePopover();
    },
    [editor, closePopover]
  );
  insertMentionRef.current = insertMention;

  const runCommand = useCallback(
    (command: CommandItem) => {
      if (command.key === "clear") {
        if (!streaming) {
          newChat();
          editor?.commands.clearContent();
          setAttachments([]);
          setNotice(null);
        }
      }
      closePopover();
    },
    [streaming, newChat, editor, closePopover]
  );
  runCommandRef.current = runCommand;

  const doSend = useCallback(async () => {
    if (!editor) return;
    const text = extractPromptFromDoc(editor.state.doc).trim();
    if (!text && attachments.length === 0) return;

    const pending = attachments;
    const savedDoc = editor.getJSON();
    editor.commands.clearContent();
    setAttachments([]);
    setNotice(null);
    closePopover();

    const ok = await send(text, pending);
    if (!ok) {
      editor.commands.setContent(savedDoc);
      setAttachments(pending);
    }
  }, [editor, attachments, send, closePopover]);
  doSendRef.current = doSend;

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
          if (event.text && editor) {
            const currentText = extractPromptFromDoc(editor.state.doc);
            const needsSpace =
              currentText.length > 0 && !/\s$/.test(currentText);
            editor
              .chain()
              .focus()
              .insertContent(needsSpace ? ` ${event.text}` : event.text)
              .run();
          }
        } else {
          setNotice(event.message);
        }
      });
    } catch (e) {
      setRecording(false);
      setNotice(api.errorMessage(e));
    }
  }, [recording, editor]);
  toggleDictationRef.current = toggleDictation;

  const pickFiles = useCallback(
    async (imagesOnly: boolean) => {
      const selected = await openDialog({
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

  const canSend = hasContent || attachments.length > 0;

  return (
    <div className="Composer" data-recording={recording || undefined}>
      {popoverOpen && (
        <div className="MentionPopover" role="listbox">
          {trigger === "@" ? (
            loadingFiles ? (
              <div className="MentionItem MentionItem-empty">
                Searching workspace…
              </div>
            ) : fileHits.length === 0 ? (
              <div className="MentionItem MentionItem-empty">
                {query
                  ? `No files matching "${query}"`
                  : "No workspace files found"}
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
            <div className="MentionItem MentionItem-empty">
              No matching actions
            </div>
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

        <div
          className={
            promptMode
              ? "Composer-inputArea Composer-inputArea-prompt"
              : "Composer-inputArea"
          }
        >
          <EditorContent editor={editor} />

          <div
            className={
              promptMode
                ? "Composer-row Composer-row-prompt"
                : "Composer-row"
            }
          >
            <DropdownMenu>
              <Tooltip content="Add files or images" side="top">
                <DropdownMenuTrigger asChild>
                  <Button
                    className="Composer-plus"
                    aria-label="Add attachment"
                  >
                    <VscAdd />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent sideOffset={6} align="start">
                <DropdownMenuItem
                  disabled={!modelSupportsImages}
                  onSelect={() => {
                    if (modelSupportsImages) void pickFiles(true);
                  }}
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

            {!promptMode && (
              <ContextBar
                maxContext={maxContext}
                contextTokens={sessionTokens.contextTokens}
                fillPct={fillPct}
              />
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
                className={`Composer-send${
                  streaming
                    ? " Composer-stop"
                    : recording
                    ? " Composer-mic-send"
                    : !canSend
                    ? " Composer-mic-idle"
                    : ""
                }`}
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
                  if (streaming) {
                    cancel();
                    return;
                  }
                  if (recording) {
                    void toggleDictation();
                    return;
                  }
                  if (canSend) {
                    void doSend();
                    return;
                  }
                  void toggleDictation();
                }}
              >
                {streaming ? (
                  <VscDebugStop />
                ) : recording ? (
                  <span className="Composer-micWaves" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
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
          <div className="Composer-footer-right">
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              align="end"
            />
            <ContextBar
              maxContext={maxContext}
              contextTokens={sessionTokens.contextTokens}
              fillPct={fillPct}
            />
          </div>
        </div>
      )}
    </div>
  );
}
