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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { FilePill, ImageThumb, IMAGE_ACCEPT, FILE_ACCEPT } from '@/components/ui/attachment';
import { VscSend, VscDebugStop, VscFileMedia, VscFile } from 'react-icons/vsc';
import { el } from '@/lib/electron';
import tippy, { Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';

const MentionList = ({ items, command, selectedIndex, onHighlight }: any) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  return (
    <div className="bg-popover border border-border rounded-md shadow-lg p-1 text-xs z-50 max-h-52 overflow-y-auto w-full flex flex-col gap-px">
      {items.length === 0 ? <div className="px-2 py-1.5 text-foreground/40 text-center">No files found</div> : items.map((item: any, idx: number) => (
        <button key={item.id} ref={idx === selectedIndex ? activeRef : null} onMouseDown={(e) => { e.preventDefault(); command(item); }} onMouseEnter={() => onHighlight(idx)}
          className={cn("w-full text-left px-2 py-1 rounded-sm flex items-center gap-2 outline-hidden transition-colors text-xs", idx === selectedIndex ? "bg-white/6 text-foreground" : "text-foreground/60 hover:bg-white/4 hover:text-foreground/90")}>
          <span className="shrink-0 size-3.5 flex items-center justify-center"><FileIcon fileName={item.label} className="size-3.5" /></span>
          <span className="truncate flex-1 font-mono">{item.label}</span>
        </button>
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
          root?.unmount(); popup?.destroy();
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
  const label = props.node.attrs.label ?? props.node.attrs.id;
  const handleClick = (e: any) => { e.preventDefault(); e.stopPropagation(); const cId = useConversationsStore.getState().activeConvId; if (cId) useUIStore.getState().openWorkspaceFile(cId, label); };
  return <NodeViewWrapper as="span" className="inline-flex items-center" onClick={handleClick}><span className="mention font-sans align-middle select-none mx-0.5"><FileIcon fileName={label} className="size-3 shrink-0" /><span>{label}</span></span></NodeViewWrapper>;
};

export default function TiptapInput({ onSubmit, onStop, workspacePath, disabled, isStreaming }: any) {
  const submitRef = useRef<any>(null), fileInputRef = useRef<HTMLInputElement>(null), [attachments, setAttachments] = useState<any[]>([]);
  const model = useModelsStore(s => s.models[s.selectedKey] ?? null);
  const tokenCount = useConversationsStore(s => s.activeConvId ? s.convs[s.activeConvId]?.tokenCount ?? 0 : 0);
  const contextWindow = model?.contextWindow || 128000;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Plan, Build, / for skills, @ for context' }),
      Mention.extend({ addNodeView() { return ReactNodeViewRenderer(MentionNodeView); } }).configure({ HTMLAttributes: { class: 'mention' }, suggestion: buildMentionSuggestion() }),
      CharacterCount,
    ],
    editorProps: {
      attributes: { class: 'prose prose-invert max-w-none text-sm outline-none min-h-5 max-h-52 overflow-y-auto py-0.5 px-0 leading-relaxed' },
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
    const loaded: any[] = await Promise.all(files.map((f: any) => new Promise<any>((res) => { const r = new FileReader(); r.onload = () => res({ name: f.name, dataUrl: r.result as string, mimeType: f.type }); r.readAsDataURL(f); })));
    setAttachments(prev => [...prev, ...loaded]); e.target.value = '';
  };
  const pick = (accept: string) => { const inp = fileInputRef.current; if (inp) { inp.accept = accept; inp.click(); } };
  const removeAttachment = (i: number) => setAttachments(p => p.filter((_, j) => j !== i));
  return (
    <div className="border border-border/60 rounded-xl bg-card px-3.5 pt-2.5 pb-2.5 flex flex-col gap-1.5 focus-within:border-border transition-colors duration-100">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/30 pb-2 mb-1.5">{attachments.map((a, i) => (
          a.mimeType?.startsWith('image/')
            ? <ImageThumb key={i} name={a.name} dataUrl={a.dataUrl} onRemove={() => removeAttachment(i)} className="size-12" />
            : <FilePill key={i} name={a.name} onRemove={() => removeAttachment(i)} />
        ))}</div>
      )}
      <EditorContent editor={editor} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {model?.multimodal ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" id="attach-btn" variant="ghost" size="icon-sm" className="rounded-full border border-border/50 text-foreground/35 hover:text-foreground/70 hover:border-border text-base font-light leading-none">+</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-32">
                <DropdownMenuItem onSelect={() => pick(IMAGE_ACCEPT)}><VscFileMedia /> Image</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => pick(FILE_ACCEPT)}><VscFile /> File</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip><TooltipTrigger asChild>
              <Button type="button" id="attach-btn" variant="ghost" size="icon-sm" onClick={() => pick(FILE_ACCEPT)} className="rounded-full border border-border/50 text-foreground/35 hover:text-foreground/70 hover:border-border text-base font-light leading-none">+</Button>
            </TooltipTrigger><TooltipContent side="top">Attach file</TooltipContent></Tooltip>
          )}
          <ModelDropdown />
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const pct = Math.min((tokenCount / contextWindow) * 100, 100);
            return (
              <Tooltip><TooltipTrigger asChild>
                <div className="size-3.5 flex items-center justify-center cursor-help shrink-0 select-none">
                  <svg className="size-3.5 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" className="stroke-white/10" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15" fill="none" className={pct > 80 ? 'stroke-destructive' : pct > 60 ? 'stroke-amber-400' : 'stroke-emerald-500'} strokeWidth="4" strokeDasharray="100" strokeDashoffset={100 - pct} pathLength="100" />
                  </svg>
                </div>
              </TooltipTrigger><TooltipContent side="top"><span className="font-mono">{tokenCount.toLocaleString()} / {contextWindow.toLocaleString()} tokens ({pct.toFixed(1)}%)</span></TooltipContent></Tooltip>
            );
          })()}
          {isStreaming
            ? <Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="destructive" onClick={onStop} className="rounded-full size-6"><VscDebugStop className="size-3" /></Button></TooltipTrigger><TooltipContent side="top">Stop</TooltipContent></Tooltip>
            : <Tooltip><TooltipTrigger asChild><Button type="button" size="icon" variant="default" onClick={handleSubmit} disabled={disabled} className="rounded-full size-6"><VscSend className="size-3" /></Button></TooltipTrigger><TooltipContent side="top">Send (Enter)</TooltipContent></Tooltip>
          }
        </div>
      </div>
    </div>
  );
}
