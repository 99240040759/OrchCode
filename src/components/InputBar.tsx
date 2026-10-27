import { useCallback, useRef, useState } from "react";
import { VscAdd } from "react-icons/vsc";
import { RiFileTextLine, RiImageLine } from "react-icons/ri";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import * as utils from "../lib/utils";
import { useChatStore } from "../lib/store";
import { useConnectorsStore } from "../lib/connectors";
import { useWorkspaceStore } from "../lib/workspace";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { AttachmentCard } from "./ChatPrimitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";

import { FileMention, extractPromptFromDoc } from "./composer/MentionNodeView";
import { ModelSelector } from "./composer/ModelSelector";
import { WorkspaceDisplay } from "./composer/WorkspaceDisplay";
import { ContextBar } from "./composer/ContextBar";
import { ConnectorsMenu } from "./composer/ConnectorsMenu";
import { SuggestionPopover } from "./composer/SuggestionPopover";
import { ComposerActionBtn } from "./composer/ComposerActionBtn";
import { useSuggestions } from "./composer/hooks/useSuggestions";
import { useDictation } from "./composer/hooks/useDictation";
import { useComposerAttachments } from "./composer/hooks/useComposerAttachments";
import type { CommandItem } from "./composer/types";

export function InputBar({ promptMode = false }: { promptMode?: boolean }) {
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const streaming = useChatStore((s) => s.streaming);
  const models = useChatStore((s) => s.models);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const newChat = useChatStore((s) => s.newChat);
  const sessionTokens = useChatStore((s) => s.sessionTokens);
  const refreshConnectors = useConnectorsStore((s) => s.refresh);
  const currentWs = useWorkspaceStore((s) => s.current);

  const [notice, setNotice] = useState<string | null>(null);
  const [hasContent, setHasContent] = useState(false);

  const modelSupportsImages =
    selectedModel?.capabilities.includes("images") ?? false;

  const {
    attachments,
    setAttachments,
    removeAttachment,
    clearAttachments,
    pickFiles,
  } = useComposerAttachments({
    modelSupportsImages,
    modelName: selectedModel?.name,
    setNotice,
  });

  const editorRef = useRef<Editor | null>(null);
  const doSendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const insertMentionRef = useRef<(filePath: string) => void>(() => {});
  const runCommandRef = useRef<(command: CommandItem) => void>(() => {});

  const suggestions = useSuggestions({
    onInsertMention: (filePath) => insertMentionRef.current(filePath),
    onRunCommand: (command) => runCommandRef.current(command),
  });

  const dictation = useDictation({
    editorRef,
    setNotice,
  });

  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  const placeholderText = promptMode
    ? "Write a message..."
    : "Ask anything, @ to mention a file, / for actions";

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
        if (event.isComposing || event.keyCode === 229) return false;

        if (suggestionsRef.current.isOpen && suggestionsRef.current.handleKeyDown(event)) {
          return true;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (dictationRef.current.recording) {
            void dictationRef.current.stopDictation();
          }
          void doSendRef.current();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = !ed.isEmpty;
      setHasContent((prev) => (prev === next ? prev : next));
      suggestionsRef.current.checkToken(ed);
    },
    onSelectionUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) {
        suggestionsRef.current.checkToken(ed);
      }
    },
  });

  editorRef.current = editor;

  const insertMention = useCallback(
    (filePath: string) => {
      if (!editor) return;
      const filename = utils.getBasename(filePath) || filePath;
      const range = suggestions.tokenRangeRef.current;
      const chain = editor.chain().focus();
      if (range) {
        chain.deleteRange({ from: range.from, to: range.to });
      }
      chain
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
      suggestions.close();
    },
    [editor, suggestions]
  );
  insertMentionRef.current = insertMention;

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
  runCommandRef.current = runCommand;

  const doSend = useCallback(async () => {
    if (!editor) return;
    const text = extractPromptFromDoc(editor.state.doc).trim();
    if (!text && attachments.length === 0) return;

    const pending = attachments;
    const savedDoc = editor.getJSON();
    editor.commands.clearContent();
    clearAttachments();
    setNotice(null);
    suggestions.close();

    const ok = await send(text, pending);
    if (!ok) {
      editor.commands.setContent(savedDoc);
      setAttachments(pending);
    }
  }, [editor, attachments, clearAttachments, suggestions, send, setAttachments]);
  doSendRef.current = doSend;

  const canSend = hasContent || attachments.length > 0;

  return (
    <div className="Composer" data-recording={dictation.recording || undefined}>
      <SuggestionPopover
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
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) void refreshConnectors();
              }}
            >
              <Tooltip content="Add files, images, or connectors" side="top">
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
                  <RiImageLine />
                  <span>Image</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pickFiles(false)}>
                  <RiFileTextLine />
                  <span>File</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <ConnectorsMenu />
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
                contextWindow={selectedModel?.contextWindow}
                sessionTokens={sessionTokens}
              />
            )}

            <ComposerActionBtn
              streaming={streaming}
              recording={dictation.recording}
              canSend={canSend}
              onSend={() => void doSend()}
              onCancel={cancel}
              onToggleDictation={() => void dictation.toggleDictation()}
            />
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
              contextWindow={selectedModel?.contextWindow}
              sessionTokens={sessionTokens}
            />
          </div>
        </div>
      )}
    </div>
  );
}
