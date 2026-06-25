import { useRef, useState, useEffect } from "react";
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
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
const MentionList = ({ items, command, selectedIndex, onHighlight }: any) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-1 text-xs z-50 max-h-56 overflow-y-auto w-full flex flex-col gap-0.5 scrollbar-thin">
      {items.length === 0 ? <div className="px-2 py-1.5 text-muted-foreground text-center">No files found</div> : items.map((item: any, idx: number) => (
        <button key={item.id} ref={idx === selectedIndex ? activeRef : null} onMouseDown={(e) => { e.preventDefault(); command(item); }} onMouseEnter={() => onHighlight(idx)} className={cn("w-full text-left px-2 py-1.5 rounded-sm flex items-center gap-2 transition-colors outline-hidden text-sm hover:bg-accent hover:text-accent-foreground", idx === selectedIndex ? "bg-accent text-accent-foreground" : "text-popover-foreground")}><span className="shrink-0 size-4 flex items-center justify-center"><FileIcon fileName={item.label} className="size-4" /></span><span className="truncate flex-1 font-mono text-xs">{item.label}</span></button>
      ))}
    </div>
  );
};
function buildMentionSuggestion() {
  return {
    char: '@',
    items: async ({ query }: any) => {
      const cId = useConversationsStore.getState().activeConvId; if (!cId) return [];
      const conv = useConversationsStore.getState().convs[cId], wsPath = conv?.workspaceId ? useWorkspacesStore.getState().workspaces.find(w => w.id === conv.workspaceId)?.path : null;
      if (!wsPath) return [];
      try { const files = await el.listWorkspaceFiles(wsPath, query); return files.map((f: any) => ({ id: f, label: f })); } catch { return []; }
    },
    render: () => {
      let component: HTMLElement, root: any = null, popup: Instance | null = null, selectedIndex = 0, currentProps: any = null;
      const renderReact = () => { if (currentProps && root) root.render(<MentionList items={currentProps.items} command={currentProps.command} selectedIndex={selectedIndex} onHighlight={(idx: number) => { selectedIndex = idx; renderReact(); }} />); };
      const setWidth = (props: any) => { if (component) component.style.width = `${props.editor.view.dom.getBoundingClientRect().width}px`; };
      return {
        onStart: (props: any) => {
          currentProps = props; selectedIndex = 0; component = document.createElement('div'); setWidth(props); root = createRoot(component); renderReact();
          popup = tippy('body', { getReferenceClientRect: props.clientRect, appendTo: () => document.body, content: component, showOnCreate: true, interactive: true, trigger: 'manual', placement: 'top-start', theme: 'mention' })[0];
        },
        onUpdate: (props: any) => { currentProps = props; setWidth(props); popup?.setProps({ getReferenceClientRect: props.clientRect }); renderReact(); },
        onKeyDown: (props: any) => {
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
const MentionNodeView = (props: any) => {
  const label = props.node.attrs.label ?? props.node.attrs.id, handleClick = async (e: any) => {
    e.preventDefault(); e.stopPropagation();
    const cId = useConversationsStore.getState().activeConvId; if (!cId) return;
    const conv = useConversationsStore.getState().convs[cId], ws = useWorkspacesStore.getState().workspaces.find(w => w.id === conv?.workspaceId);
    if (ws) { const c = await el.readWorkspaceFile(ws.path, label); useUIStore.getState().openFileViewer(cId, label, c, 1, c.split('\n').length); }
  };
  return <NodeViewWrapper as="span" className="inline-flex items-center" onClick={handleClick}><span className="px-1.5 py-0.5 bg-accent text-accent-foreground rounded-md inline-flex items-center gap-1 font-mono text-xs cursor-pointer transition-colors align-middle select-none mx-0.5"><FileIcon fileName={label} className="size-3.5 shrink-0" /><span>{label}</span></span></NodeViewWrapper>;
};
export default function TiptapInput({ onSubmit, onStop, workspacePath, disabled, isStreaming, tokenCount = 0, contextWindow = 128000 }: any) {
  const submitRef = useRef<any>(null), fileInputRef = useRef<HTMLInputElement>(null), [attachments, setAttachments] = useState<any[]>([]), model = useModelsStore(s => s.models[s.selectedKey] ?? null);
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: 'Plan, Build, / for skills, @ for context' }), Mention.extend({ addNodeView() { return ReactNodeViewRenderer(MentionNodeView); } }).configure({ HTMLAttributes: { class: 'mention' }, suggestion: buildMentionSuggestion() }), CharacterCount],
    editorProps: {
      attributes: { class: 'prose prose-invert max-w-none text-sm outline-none min-h-6 max-h-56 overflow-y-auto py-1 px-0' },
      handleKeyDown: (_view, event) => { if (event.key === 'Enter' && !event.shiftKey && !document.querySelector('.tippy-box[data-theme~="mention"]')) { event.preventDefault(); submitRef.current?.(); return true; } return false; }
    }
  });
  const handleSubmit = () => {
    if (!editor || disabled) return;
    const parts: any[] = []; let buf = '', first = true;
    const flushText = () => { if (buf) { parts.push({ type: 'text', text: buf }); buf = ''; } };
    editor.state.doc.forEach((block: any) => {
      if (!first) buf += '\n'; first = false;
      block.forEach((inline: any) => { if (inline.isText) buf += inline.text || ''; else if (inline.type.name === 'mention') { flushText(); parts.push({ type: 'mention', path: inline.attrs.id }); } });
    });
    flushText();
    if (!parts.some(p => p.type === 'text' && p.text.trim()) && !parts.some(p => p.type === 'mention') && attachments.length === 0) return;
    onSubmit(parts, attachments.length ? attachments : undefined); editor.commands.clearContent(); setAttachments([]);
  };
  submitRef.current = handleSubmit;
  const handleFileChange = async (e: any) => {
    const files = Array.from(e.target.files || []);
    const loaded: any[] = await Promise.all(files.map(f => new Promise<any>((res) => { const r = new FileReader(); r.onload = () => res({ name: f.name, dataUrl: r.result as string, mimeType: f.type }); r.readAsDataURL(f); })));
    setAttachments(prev => [...prev, ...loaded]); e.target.value = '';
  };
  return (
    <div className="border border-border rounded-2xl bg-card px-4 pt-3 pb-3 flex flex-col gap-2">
      <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md,.csv" multiple className="hidden" onChange={handleFileChange} />
      {attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{attachments.map((a, i) => <div key={i} className="flex items-center gap-1 bg-muted rounded-md px-2 py-0.5 text-xs max-w-36"><span className="truncate">{a.name}</span><Button type="button" variant="ghost" size="icon-xs" onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground hover:bg-transparent"><VscChromeClose className="size-3" /></Button></div>)}</div>}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-2">
          {model?.multimodal && <Tooltip><TooltipTrigger asChild><Button type="button" id="attach-btn" variant="ghost" size="icon-sm" onClick={() => fileInputRef.current?.click()} className="rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-border text-lg font-light">+</Button></TooltipTrigger><TooltipContent side="top">Attach file</TooltipContent></Tooltip>}
          <ModelDropdown />
        </div>
        <div className="flex items-center gap-2.5">
          {(() => {
            const pct = Math.min((tokenCount / contextWindow) * 100, 100);
            return <Tooltip><TooltipTrigger asChild><div className="size-4 flex items-center justify-center cursor-help shrink-0 select-none"><svg className="size-4 -rotate-90" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" className="stroke-muted" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" className={pct > 80 ? 'stroke-destructive' : pct > 60 ? 'stroke-amber-400' : 'stroke-emerald-500'} strokeWidth="4" strokeDasharray="100" strokeDashoffset={100 - pct} pathLength="100" /></svg></div></TooltipTrigger><TooltipContent side="top"><span className="font-mono text-xs">{tokenCount.toLocaleString()} / {contextWindow.toLocaleString()} tokens ({pct.toFixed(1)}%)</span></TooltipContent></Tooltip>;
          })()}
          {isStreaming ? <Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="destructive" onClick={onStop} className="rounded-full"><VscDebugStop className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="top">Stop generation</TooltipContent></Tooltip> : <Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="default" onClick={handleSubmit} disabled={disabled} className="rounded-full"><VscSend className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="top">Send (Enter)</TooltipContent></Tooltip>}
        </div>
      </div>
    </div>
  );
}
