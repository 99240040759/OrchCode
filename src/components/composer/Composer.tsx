import { useCallback, useEffect, useRef, useState } from "react";
import { LuArrowUp, LuFileText, LuImage, LuMic, LuPlus, LuSquare } from "react-icons/lu";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { getBasename } from "../../lib/utils";
import { useChatStore } from "../../lib/store";
import { useConnectorsStore } from "../../lib/connectors";
import { useWorkspaceStore } from "../../lib/workspace";
import { Attachment } from "../common/Attachment";
import { Button, IconButton } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { useArtifactsStore } from "../../lib/artifacts";
import { ProjectMenu } from "../projects/ProjectMenu";
import { ConnectorsMenu } from "./ConnectorsMenu";
import { ContextRing } from "./ContextRing";
import { FileMention, extractPromptFromDoc } from "./MentionNode";
import { ModelMenu } from "./ModelMenu";
import { Suggestions } from "./Suggestions";
import { useComposerAttachments } from "./hooks/useComposerAttachments";
import { useDictation } from "./hooks/useDictation";
import { useSuggestions } from "./hooks/useSuggestions";
import type { CommandItem } from "./types";

const PLACEHOLDER = "Ask anything, @ to mention, / for actions";

export function Composer({ home }: { home: boolean }) {
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const streaming = useChatStore((s) => s.streaming);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const newChat = useChatStore((s) => s.newChat);
  const usage = useChatStore((s) => s.sessionTokens);
  const refreshConnectors = useConnectorsStore((s) => s.refresh);
  const githubConnected = useConnectorsStore((s) => s.github?.connected ?? false);
  const current = useWorkspaceStore((s) => s.current);
  const cloud = useWorkspaceStore((s) => s.mode) === "cloud";

  useEffect(() => {
    if (cloud) void refreshConnectors();
  }, [cloud, refreshConnectors]);

  const sendEnabled = !cloud || (githubConnected && Boolean(current));
  const imagesSupported = selectedModel?.capabilities.includes("images") ?? false;
  const [notice, setNotice] = useState<string | null>(null);
  const [hasContent, setHasContent] = useState(false);

  const { attachments, setAttachments, removeAttachment, clearAttachments, pickFiles } = useComposerAttachments({
    modelSupportsImages: imagesSupported,
    modelName: selectedModel?.name,
    setNotice,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const sendRef = useRef<() => Promise<void>>(async () => {});
  const insertRef = useRef<(path: string) => void>(() => {});
  const commandRef = useRef<(command: CommandItem) => void>(() => {});

  const suggestions = useSuggestions({
    onInsertMention: (path) => insertRef.current(path),
    onRunCommand: (command) => commandRef.current(command),
  });
  const dictation = useDictation({ editorRef, setNotice });
  const live = useRef({ suggestions, dictation });
  live.current = { suggestions, dictation };

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({ placeholder: PLACEHOLDER, emptyEditorClass: "is-editor-empty" }),
      FileMention,
    ],
    editorProps: {
      attributes: { class: "composer-input", "aria-label": "Message" },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229) return false;
        const { suggestions: s, dictation: d } = live.current;
        if (s.isOpen && s.handleKeyDown(event)) return true;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (d.recording) void d.stopDictation();
          void sendRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setHasContent(!ed.isEmpty);
      live.current.suggestions.checkToken(ed);
    },
    onSelectionUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) live.current.suggestions.checkToken(ed);
    },
  });
  editorRef.current = editor;

  const insertMention = useCallback(
    (path: string) => {
      if (!editor) return;
      const range = suggestions.tokenRangeRef.current;
      const chain = editor.chain().focus();
      if (range) chain.deleteRange(range);
      chain
        .insertContent([
          { type: "mention", attrs: { id: path, label: getBasename(path) || path } },
          { type: "text", text: " " },
        ])
        .run();
      suggestions.close();
    },
    [editor, suggestions]
  );
  insertRef.current = insertMention;

  const runCommand = useCallback(
    (command: CommandItem) => {
      if (command.key === "clear" && !streaming) {
        newChat();
        editor?.commands.clearContent();
        clearAttachments();
        setNotice(null);
      }
      suggestions.close();
    },
    [editor, streaming, newChat, clearAttachments, suggestions]
  );
  commandRef.current = runCommand;

  const doSend = useCallback(async () => {
    if (!editor || !sendEnabled) return;
    const text = extractPromptFromDoc(editor.state.doc).trim();
    if (!text && attachments.length === 0) return;
    const pending = attachments;
    const saved = editor.getJSON();
    editor.commands.clearContent();
    clearAttachments();
    setNotice(null);
    suggestions.close();
    if (!(await send(text, pending))) {
      editor.commands.setContent(saved);
      setAttachments(pending);
    }
  }, [editor, sendEnabled, attachments, clearAttachments, suggestions, send, setAttachments]);
  sendRef.current = doSend;

  const canSend = hasContent || attachments.length > 0;

  return (
    <div className="dock-inner">
      {home && (
        <div className="composer-head">
          <ProjectMenu />
        </div>
      )}
      <div ref={rootRef} className="composer" data-recording={dictation.recording || undefined}>
        <Suggestions
          anchorRef={rootRef}
          trigger={suggestions.trigger}
          query={suggestions.query}
          fileHits={suggestions.fileHits}
          commandHits={suggestions.commandHits}
          loadingFiles={suggestions.loadingFiles}
          activeIndex={suggestions.activeIndex}
          onSelectFile={insertMention}
          onSelectCommand={runCommand}
          onHighlight={suggestions.setHighlighted}
        />

        {attachments.length > 0 && (
          <div
            className="composer-files"
            onWheel={(e) => {
              if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {attachments.map((a) => (
              <Attachment
                key={a.path}
                name={a.name}
                isImage={a.isImage}
                path={a.path}
                onOpen={() => useArtifactsStore.getState().openFile(a.path)}
                onRemove={() => removeAttachment(a.path)}
              />
            ))}
          </div>
        )}

        {notice && (
          <div className="composer-notice" role="status">
            {notice}
          </div>
        )}

        <EditorContent editor={editor} />

        <div className="composer-row">
          <Menu onOpenChange={(open) => open && void refreshConnectors()}>
            <Tooltip content="Add files, images, or connectors">
              <MenuTrigger asChild>
                <Button icon size="sm" aria-label="Add attachment">
                  <LuPlus />
                </Button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent align="start" side="top">
              <MenuItem disabled={!imagesSupported} onSelect={() => imagesSupported && void pickFiles(true)}>
                <LuImage />
                <span className="row-label">Image</span>
              </MenuItem>
              <MenuItem onSelect={() => void pickFiles(false)}>
                <LuFileText />
                <span className="row-label">File</span>
              </MenuItem>
              <MenuSeparator />
              <ConnectorsMenu />
            </MenuContent>
          </Menu>

          <ModelMenu />
          <span className="grow" />

          {(home || usage.contextTokens > 0) && (
            <ContextRing contextWindow={selectedModel?.contextWindow} usage={usage} />
          )}

          <IconButton
            label={dictation.recording ? "Stop dictation" : "Voice dictation"}
            side="top"
            size="sm"
            className="composer-mic"
            active={dictation.recording}
            disabled={streaming}
            onClick={() => void dictation.toggleDictation()}
          >
            {dictation.recording ? <LuSquare /> : <LuMic />}
          </IconButton>

          {streaming ? (
            <IconButton label="Stop generating" side="top" variant="primary" className="composer-send" onClick={cancel}>
              <LuSquare />
            </IconButton>
          ) : (
            sendEnabled && (
              <IconButton
                label="Send"
                tip="Send (Enter)"
                side="top"
                variant="primary"
                className="composer-send"
                disabled={!canSend}
                onClick={() => void doSend()}
              >
                <LuArrowUp />
              </IconButton>
            )
          )}
        </div>
      </div>
    </div>
  );
}
