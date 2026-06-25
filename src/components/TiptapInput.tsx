import { useRef, useState, useEffect } from "react";
import type React from "react";
import { createRoot, Root } from 'react-dom/client';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import CharacterCount from '@tiptap/extension-character-count';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { useUIStore } from '@/store/ui';
import { useModelsStore } from '@/store/models';
import ModelDropdown from './ModelDropdown';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/ui/FileIcon';
import { VscSend, VscDebugStop, VscChromeClose } from 'react-icons/vsc';
import { el } from '@/lib/electron';
import tippy, { Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
interface MentionItem { id: string; label: string; }
const MentionList = ({ items, command, selectedIndex, onHighlight }: { items: MentionItem[]; command: (item: MentionItem) => void; selectedIndex: number; onHighlight: (idx: number) => void }) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-1 text-xs z-50 max-h-56 overflow-y-auto w-full flex flex-col gap-0.5 scrollbar-thin">
      {items.length === 0 ? <div className="px-2 py-1.5 text-muted-foreground text-center">No files found</div> : items.map((item, idx) => (
        <button key={item.id} ref={idx === selectedIndex ? activeRef : null} onMouseDown={(e) => { e.preventDefault(); command(item); }} onMouseEnter={() => onHighlight(idx)}
          className={cn("w-full text-left px-2 py-1.5 rounded-sm flex items-center gap-2 transition-colors outline-hidden text-sm hover:bg-accent hover:text-accent-foreground", idx === selectedIndex ? "bg-accent text-accent-foreground" : "text-popover-foreground")}>
          <span className="shrink-0 size-4 flex items-center justify-center"><FileIcon fileName={item.label} className="size-4" /></span>
          <span className="truncate flex-1 font-mono text-xs">{item.label}</span>
        </button>
      ))}
    </div>
  );
};
function buildMentionSuggestion() {
  return {
    char: '@',
    items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
      const convId = useConversationsStore.getState().activeConvId;
      if (!convId) return [];
      const conv = useConversationsStore.getState().convs[convId];
      const wsPath = conv?.workspaceId ? useWorkspacesStore.getState().workspaces.find(w => w.id === conv.workspaceId)?.path : null;
      if (!wsPath) return [];
      try { const files: string[] = await el.listWorkspaceFiles(wsPath, query); return files.map(f => ({ id: f, label: f })); }
      catch { return []; }
    },
    render: () => {
      let component: HTMLElement, root: Root | null = null, popup: Instance | null = null, selectedIndex = 0, currentProps: SuggestionProps<MentionItem> | null = null;
      const renderReact = () => { if (currentProps && root) root.render(<MentionList items={currentProps.items} command={currentProps.command} selectedIndex={selectedIndex} onHighlight={(idx) => { selectedIndex = idx; renderReact(); }} />); };
      const setWidth = (props: SuggestionProps<MentionItem>) => { if (component) component.style.width = `${props.editor.view.dom.getBoundingClientRect().width}px`; };
      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          currentProps = props; selectedIndex = 0; component = document.createElement('div'); setWidth(props); root = createRoot(component); renderReact();
          popup = tippy('body', { getReferenceClientRect: props.clientRect as () => DOMRect, appendTo: () => document.body, content: component, showOnCreate: true, interactive: true, trigger: 'manual', placement: 'top-start', theme: 'mention' })[0];
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => { currentProps = props; setWidth(props); popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect }); renderReact(); },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (!currentProps || currentProps.items.length === 0) return false;
          if (props.event.key === 'ArrowUp') { selectedIndex = (selectedIndex + currentProps.items.length - 1) % currentProps.items.length; renderReact(); return true; }
          if (props.event.key === 'ArrowDown') { selectedIndex = (selectedIndex + 1) % currentProps.items.length; renderReact(); return true; }
          if (props.event.key === 'Enter' || props.event.key === 'Tab') { if (currentProps.items[selectedIndex]) { currentProps.command(currentProps.items[selectedIndex]); return true; } }
          if (props.event.key === 'Escape') { popup?.hide(); return true; }
          return false;
        },
        onExit: () => { popup?.destroy(); root?.unmount(); },
      };
    },
  };
}
const MentionNodeView = (props: NodeViewProps) => {
  const label = (props.node.attrs.label as string | undefined) ?? (props.node.attrs.id as string);
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const convId = useConversationsStore.getState().activeConvId;
    if (!convId) return;
    const conv = useConversationsStore.getState().convs[convId];
    const ws = useWorkspacesStore.getState().workspaces.find(w => w.id === conv?.workspaceId);
    if (ws) {
      const content = await el.readWorkspaceFile(ws.path, label);
      const activeConvId = useConversationsStore.getState().activeConvId || '';
      useUIStore.getState().openFileViewer(activeConvId, label, content, 1, content.split('\n').length);
    }
  };
  return (
    <NodeViewWrapper as="span" className="inline-flex items-center" onClick={handleClick}>
      <span className="px-1.5 py-0.5 bg-accent/50 hover:bg-accent/85 text-accent-foreground rounded-md inline-flex items-center gap-1 font-mono text-xs cursor-pointer transition-colors align-middle select-none mx-0.5">
        <FileIcon fileName={label} className="size-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    </NodeViewWrapper>
  );
};
interface Attachment { name: string; dataUrl: string; mimeType: string; }
type EditorPart = { type: 'text'; text: string } | { type: 'mention'; path: string };
export default function TiptapInput({ onSubmit, onStop, workspacePath, disabled, isStreaming, tokenCount = 0, contextWindow = 128000 }: { onSubmit: (parts: EditorPart[], attachments?: Attachment[]) => void; onStop?: () => void; workspacePath: string | null; disabled?: boolean; isStreaming?: boolean; tokenCount?: number; contextWindow?: number }) {
  const submitRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const model = useModelsStore(s => s.models[s.selectedKey] ?? null);
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: 'Plan, Build, / for skills, @ for context' }), Mention.extend({ addNodeView() { return ReactNodeViewRenderer(MentionNodeView); } }).configure({ HTMLAttributes: { class: 'mention' }, suggestion: buildMentionSuggestion() }), CharacterCount],
    editorProps: {
      attributes: { class: 'prose prose-invert max-w-none text-sm outline-none min-h-6 max-h-56 overflow-y-auto py-1 px-0' },
      handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey && !document.querySelector('.tippy-box[data-theme~="mention"]')) { event.preventDefault(); submitRef.current?.(); return true; }
        return false;
      }
    }
  });
  const handleSubmit = () => {
    if (!editor || disabled) return;
    const parts: EditorPart[] = [];
    let buf = '', first = true;
    const flushText = () => { if (buf) { parts.push({ type: 'text', text: buf }); buf = ''; } };
    editor.state.doc.forEach((block: ProseMirrorNode) => {
      if (!first) buf += '\n'; first = false;
      block.forEach((inline: ProseMirrorNode) => {
        if (inline.isText) buf += inline.text || '';
        else if (inline.type.name === 'mention') { flushText(); parts.push({ type: 'mention', path: inline.attrs.id as string }); }
      });
    });
    flushText();
    const hasText = parts.some(p => p.type === 'text' && p.text.trim()) || parts.some(p => p.type === 'mention');
    if (!hasText && attachments.length === 0) return;
    onSubmit(parts, attachments.length ? attachments : undefined);
    editor.commands.clearContent();
    setAttachments([]);
  };
  submitRef.current = handleSubmit;
  const handleAttach = () => fileInputRef.current?.click();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const loaded: Attachment[] = await Promise.all(files.map(f => new Promise<Attachment>((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ name: f.name, dataUrl: reader.result as string, mimeType: f.type });
      reader.readAsDataURL(f);
    })));
    setAttachments(prev => [...prev, ...loaded]);
    e.target.value = '';
  };
  return (
    <div className="border border-border/60 rounded-2xl bg-card/80 backdrop-blur-sm px-4 pt-3 pb-3 flex flex-col gap-2">
      <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md,.csv" multiple className="hidden" onChange={handleFileChange} />
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1 bg-muted/50 rounded-md px-2 py-0.5 text-xs max-w-36">
              <span className="truncate">{a.name}</span>
              <Button variant="ghost" size="icon-xs" onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground hover:bg-transparent"><VscChromeClose className="size-3" /></Button>
            </div>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-2">
          {model?.multimodal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button id="attach-btn" variant="ghost" size="icon-xs" onClick={handleAttach} className="w-7 h-7 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-border text-lg font-light">+</Button>
              </TooltipTrigger>
              <TooltipContent side="top">Attach file</TooltipContent>
            </Tooltip>
          )}
          <ModelDropdown />
        </div>
        <div className="flex items-center gap-2.5">
          {(() => {
            const pct = Math.min((tokenCount / contextWindow) * 100, 100);
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="size-4 flex items-center justify-center cursor-help shrink-0 select-none">
                    <svg className="size-4 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted/40" strokeWidth="4" />
                      <circle cx="18" cy="18" r="15" fill="none" className={pct > 80 ? 'stroke-red-400' : pct > 60 ? 'stroke-amber-400' : 'stroke-emerald-500'} strokeWidth="4" strokeDasharray="100" strokeDashoffset={100 - pct} pathLength="100" />
                    </svg>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="font-mono text-xs">{tokenCount.toLocaleString()} / {contextWindow.toLocaleString()} tokens ({pct.toFixed(1)}%)</span>
                </TooltipContent>
              </Tooltip>
            );
          })()}
          {isStreaming ? (
            <Tooltip><TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={onStop} className="w-8 h-8 rounded-full bg-destructive/20 hover:bg-destructive/30 border border-destructive/40"><VscDebugStop className="size-3.5 text-destructive" /></Button>
            </TooltipTrigger><TooltipContent side="top">Stop generation</TooltipContent></Tooltip>
          ) : (
            <Tooltip><TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={handleSubmit} disabled={disabled} className="w-8 h-8 rounded-full bg-primary/15 hover:bg-primary/25 border border-primary/30 disabled:opacity-40"><VscSend className="size-3.5 text-primary" /></Button>
            </TooltipTrigger><TooltipContent side="top">Send (Enter)</TooltipContent></Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
