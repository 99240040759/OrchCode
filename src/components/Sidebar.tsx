import { useEffect, useState } from "react";
import { nanoid } from 'nanoid';
import { formatDistanceToNowStrict } from 'date-fns';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { useUIStore } from '@/store/ui';
import { selectConv } from '@/lib/selectConv';
import { Button } from '@/components/ui/button';
import { VscAdd, VscFolder, VscTrash, VscFilter, VscHistory, VscNewFolder } from 'react-icons/vsc';
import type { Workspace, Conversation } from '@/ipc/types';
import { el } from '@/lib/electron';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
const SHORT_UNITS: Record<string, string> = { second: 's', minute: 'm', hour: 'h', day: 'd', month: 'mo', year: 'y' };
function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'now';
  const str = formatDistanceToNowStrict(ts, { addSuffix: false }), [val, unit] = str.split(' ');
  return `${val}${SHORT_UNITS[unit.replace(/s$/, '')] || unit}`;
}
function ConvItem({ conv, isActive, isStreaming, onClick, onDelete }: { conv: Conversation; isActive: boolean; isStreaming: boolean; onClick: () => void; onDelete: () => void }) {
  return (
    <div className={`w-full flex items-center group rounded-md interactive ${isActive ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
      <Button type="button" variant="ghost" onClick={(e) => { e.preventDefault(); onClick(); }} className="flex-1 text-left pl-8 pr-3 justify-start bg-transparent hover:bg-transparent font-inherit min-w-0">
        {isStreaming && <span className="size-1.5 rounded-full bg-primary animate-pulse mr-1.5 shrink-0" />}
        <span className="truncate flex-1">{conv.title}</span>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums ml-1.5">{timeAgo(conv.updatedAt)}</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }} className="mr-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"><VscTrash className="size-3" /></Button>
    </div>
  );
}
function FolderSection({ label, icon, convs, activeConvId, streamingConvIds, onSelectConv, onDeleteConv, actions }: any) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full flex flex-col gap-px">
      <div className="w-full flex items-center group">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="flex-1 justify-start text-muted-foreground hover:text-foreground min-w-0">{icon}<span className="truncate">{label}</span>{convs.length > 0 && <span className="text-xs text-muted-foreground ml-auto tabular-nums">{convs.length}</span>}</Button></CollapsibleTrigger>
        {actions && <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-0.5 pr-1 shrink-0">{actions}</div>}
      </div>
      <CollapsibleContent className="flex flex-col gap-px">{convs.map((c: any) => <ConvItem key={c.id} conv={c} isActive={c.id === activeConvId} isStreaming={streamingConvIds.has(c.id)} onClick={() => onSelectConv(c)} onDelete={() => onDeleteConv(c)} />)}</CollapsibleContent>
    </Collapsible>
  );
}
export default function Sidebar() {
  const { workspaces, homeConversations, wsConversations, addWorkspace, removeWorkspace, setWorkspaces, setHomeConversations, setWsConversations, addConversation, removeConversation } = useWorkspacesStore();
  const activeConvId = useConversationsStore(s => s.activeConvId), { setActiveConv, initConv, removeConv } = useConversationsStore.getState(), { removeConvUI } = useUIStore();
  const streamingIdsStr = useConversationsStore(s => Object.entries(s.convs).filter(([, c]) => c.status === 'busy').map(([id]) => id).join(',')), streamingConvIds = new Set(streamingIdsStr ? streamingIdsStr.split(',') : []);
  const [filterText, setFilterText] = useState(''), [showFilter, setShowFilter] = useState(false);
  useEffect(() => {
    if (useWorkspacesStore.getState().loaded) return;
    useWorkspacesStore.getState().setLoaded(true);
    (async () => {
      const wss = await el.getWorkspaces(); setWorkspaces(wss);
      const homeConvs = await el.getConversations(null); setHomeConversations(homeConvs);
      for (const w of wss) setWsConversations(w.id, await el.getConversations(w.id));
      if (!useConversationsStore.getState().activeConvId) {
        if (!homeConvs.length) newChat(null); else selectConv(homeConvs[0].id, homeConvs[0].workspaceId);
      }
    })();
  }, []);
  const handleSelectConv = (c: Conversation) => selectConv(c.id, c.workspaceId);
  const newChat = async (wId: string | null) => {
    const c: Conversation = { id: nanoid(), workspaceId: wId, title: 'New Conversation', createdAt: Date.now(), updatedAt: Date.now() };
    addConversation(c); initConv(c.id, wId, []); setActiveConv(c.id); el.createConversation(c).catch(console.error);
  };
  const deleteConv = async (c: Conversation) => { await el.deleteConversation(c.id); removeConversation(c.id, c.workspaceId); removeConv(c.id); removeConvUI(c.id); };
  const deleteWorkspace = async (w: Workspace) => { await el.deleteWorkspace(w.id); removeWorkspace(w.id); };
  const openWorkspace = async () => { const w = await el.openWorkspaceDialog(); if (w) { addWorkspace(w); setWsConversations(w.id, []); } };
  const filterConvs = (list: Conversation[]) => filterText ? list.filter(c => c.title.toLowerCase().includes(filterText.toLowerCase())) : list;
  return (
    <div className="w-60 h-full flex flex-col border-r bg-background p-2 select-none overflow-hidden shrink-0">
      <Button type="button" variant="outline" onClick={(e) => { e.preventDefault(); newChat(null); }} className="w-full justify-start gap-2 mb-2 font-medium"><VscAdd className="size-3.5" /><span>New Conversation</span></Button>
      {showFilter && <div className="mb-1.5 shrink-0 px-1"><input autoFocus value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter conversations…" className="w-full bg-muted border border-border rounded-md px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary interactive" /></div>}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 px-0.5">
        <FolderSection label="Conversation History" icon={<VscHistory className="size-3.5 shrink-0 text-muted-foreground" />} convs={filterConvs(homeConversations)} activeConvId={activeConvId} streamingConvIds={streamingConvIds} onSelectConv={handleSelectConv} onDeleteConv={deleteConv} />
        <div className="flex items-center justify-between px-2 py-1 mt-1 select-none shrink-0">
          <span className="text-xs font-medium text-muted-foreground">Projects</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.preventDefault(); setShowFilter(f => !f); }} className={showFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}><VscFilter className="size-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.preventDefault(); openWorkspace(); }} className="text-muted-foreground hover:text-foreground"><VscNewFolder className="size-3.5" /></Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {workspaces.map(w => (
            <FolderSection key={w.id} label={w.name} icon={<VscFolder className="size-3.5 shrink-0 text-muted-foreground" />} convs={filterConvs(wsConversations[w.id] || [])} activeConvId={activeConvId} streamingConvIds={streamingConvIds} onSelectConv={handleSelectConv} onDeleteConv={deleteConv}
              actions={<><Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); e.preventDefault(); newChat(w.id); }}><VscAdd className="size-3" /></Button><Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteWorkspace(w); }} className="hover:text-destructive"><VscTrash className="size-3" /></Button></>} />
          ))}
        </div>
      </div>
    </div>
  );
}
