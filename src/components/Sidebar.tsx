import React, { useEffect, useState, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { formatDistanceToNowStrict } from 'date-fns';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { useUIStore } from '@/store/ui';
import { selectConv } from '@/lib/selectConv';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { VscAdd, VscFolderOpened, VscFolder, VscTrash, VscFilter } from 'react-icons/vsc';
import type { Workspace, Conversation } from '@/ipc/types';
import { el } from '@/lib/electron';
const SHORT_UNITS: Record<string, string> = { second: 's', minute: 'm', hour: 'h', day: 'd', month: 'mo', year: 'y' };
function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'now';
  const str = formatDistanceToNowStrict(ts, { addSuffix: false });
  const [val, unit] = str.split(' ');
  return `${val}${SHORT_UNITS[unit.replace(/s$/, '')] || unit}`;
}

function ConvItem({ conv, isActive, isStreaming, onClick, onDelete }: { conv: Conversation; isActive: boolean; isStreaming: boolean; onClick: () => void; onDelete: () => void }) {
  return (
    <div className={`w-full flex items-center group rounded-md transition-all duration-150 ${isActive ? 'bg-accent/80 text-accent-foreground' : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
      <button onClick={onClick} className="flex-1 text-left pl-7 pr-1 py-[5px] text-mini flex items-center gap-2 min-w-0">
        {isStreaming && <Spinner className="size-3 shrink-0 text-orange-400" />}
        <span className="truncate flex-1">{conv.title}</span>
        <span className="text-micro text-muted-foreground/50 shrink-0 tabular-nums">{timeAgo(conv.updatedAt)}</span>
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="px-1.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0">
        <VscTrash className="size-3" />
      </button>
    </div>
  );
}
function FolderSection({ label, icon, convs, activeConvId, streamingConvIds, onSelectConv, onDeleteConv, defaultOpen = true, actions }: {
  label: string; icon?: React.ReactNode; convs: Conversation[]; activeConvId: string | null; streamingConvIds: Set<string>;
  onSelectConv: (c: Conversation) => void; onDeleteConv: (c: Conversation) => void; defaultOpen?: boolean; actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-0.5">
      <div className="w-full flex items-center group">
        <button onClick={() => setOpen(o => !o)} className="flex-1 flex items-center gap-1.5 px-2 py-[5px] text-mini font-medium text-muted-foreground hover:text-foreground transition-colors min-w-0">
          {open ? <VscFolderOpened className="size-[14px] shrink-0 text-muted-foreground/70" /> : <VscFolder className="size-[14px] shrink-0 text-muted-foreground/70" />}
          {icon}
          <span className="truncate">{label}</span>
          <span className="text-micro text-muted-foreground/40 ml-auto shrink-0">{convs.length || ''}</span>
        </button>
        <div className="opacity-0 group-hover:opacity-100 transition-all flex items-center shrink-0 pr-1">{actions}</div>
      </div>
      {open && (
        <div className="flex flex-col gap-px">
          {convs.length === 0 && <div className="pl-7 py-1 text-micro text-muted-foreground/40 italic">No conversations</div>}
          {convs.map(c => <ConvItem key={c.id} conv={c} isActive={c.id === activeConvId} isStreaming={streamingConvIds.has(c.id)} onClick={() => onSelectConv(c)} onDelete={() => onDeleteConv(c)} />)}
        </div>
      )}
    </div>
  );
}
export default function Sidebar() {
  const { workspaces, homeConversations, wsConversations, addWorkspace, removeWorkspace, setWorkspaces, setHomeConversations, setWsConversations, addConversation, removeConversation, updateConversationTitle } = useWorkspacesStore();
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const { setActiveConv, initConv, removeConv } = useConversationsStore.getState();
  const { removeConvUI } = useUIStore();
  const streamingIdsStr = useConversationsStore(s => Object.entries(s.convs).filter(([, c]) => c.isStreaming).map(([id]) => id).join(','));
  const streamingConvIds = useMemo(() => new Set(streamingIdsStr ? streamingIdsStr.split(',') : []), [streamingIdsStr]);
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  useEffect(() => {
    (async () => {
      const wsList = await el.getWorkspaces();
      setWorkspaces(wsList);
      const homeConvs = await el.getConversations(null);
      setHomeConversations(homeConvs);
      for (const ws of wsList) { setWsConversations(ws.id, await el.getConversations(ws.id)); }
    })();
  }, []);
  const handleSelectConv = (conv: Conversation) => selectConv(conv.id, conv.workspaceId);
  // Determine which workspace is active to create new chat in
  const activeWsId = useMemo(() => {
    if (!activeConvId) return null;
    const homeMatch = homeConversations.find(c => c.id === activeConvId);
    if (homeMatch) return null;
    for (const ws of workspaces) { if ((wsConversations[ws.id] || []).find(c => c.id === activeConvId)) return ws.id; }
    return null;
  }, [activeConvId, homeConversations, workspaces, wsConversations]);
  const newChat = async (workspaceId: string | null) => {
    const conv: Conversation = { id: nanoid(), workspaceId, title: 'New Conversation', createdAt: Date.now(), updatedAt: Date.now() };
    await el.createConversation(conv);
    addConversation(conv);
    initConv(conv.id, workspaceId, []);
    setActiveConv(conv.id);
  };
  const deleteConv = async (conv: Conversation) => {
    await el.deleteConversation(conv.id);
    removeConversation(conv.id, conv.workspaceId);
    removeConv(conv.id);
    removeConvUI(conv.id);
    el.removeAgentPort(conv.id);
    el.browserDestroy(conv.id).catch(() => {});
    el.ptyKill(conv.id).catch(() => {});
  };
  const deleteWorkspace = async (ws: Workspace) => { await el.deleteWorkspace(ws.id); removeWorkspace(ws.id); };
  const openWorkspace = async () => { const ws = await el.openWorkspaceDialog(); if (!ws) return; addWorkspace(ws); setWsConversations(ws.id, []); };
  const filterConvs = (list: Conversation[]) => filterText ? list.filter(c => c.title.toLowerCase().includes(filterText.toLowerCase())) : list;
  return (
    <div className="w-[220px] min-w-[220px] h-full flex flex-col border-r bg-muted/5 overflow-hidden">
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-3 border-b shrink-0">
        <span className="text-mini font-semibold text-muted-foreground tracking-wide">Repositories</span>
        <div className="flex items-center gap-0.5">
          <Tooltip><TooltipTrigger asChild>
            <button onClick={() => setShowFilter(f => !f)} className={`p-1 rounded transition-colors ${showFilter ? 'text-orange-400' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}><VscFilter className="size-3.5" /></button>
          </TooltipTrigger><TooltipContent side="bottom">Filter</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <button onClick={() => newChat(activeWsId)} className="p-1 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors"><VscAdd className="size-3.5" /></button>
          </TooltipTrigger><TooltipContent side="bottom">New Conversation</TooltipContent></Tooltip>
        </div>
      </div>
      {/* Filter input */}
      {showFilter && (
        <div className="px-2 py-1.5 border-b shrink-0">
          <input autoFocus value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter conversations…"
            className="w-full bg-muted/40 border border-border/50 rounded-md px-2 py-1 text-mini text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-orange-500/50 transition-colors" />
        </div>
      )}
      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1 flex flex-col">
        <FolderSection label="Home" convs={filterConvs(homeConversations)} activeConvId={activeConvId} streamingConvIds={streamingConvIds}
          onSelectConv={handleSelectConv} onDeleteConv={deleteConv} />
        {workspaces.map(ws => (
          <FolderSection key={ws.id} label={ws.name} convs={filterConvs(wsConversations[ws.id] || [])} activeConvId={activeConvId} streamingConvIds={streamingConvIds}
            onSelectConv={handleSelectConv} onDeleteConv={deleteConv}
            actions={<>
              <button onClick={() => newChat(ws.id)} className="text-muted-foreground/60 hover:text-muted-foreground transition-colors p-0.5"><VscAdd className="size-3" /></button>
              <button onClick={() => deleteWorkspace(ws)} className="text-muted-foreground hover:text-destructive transition-colors p-0.5"><VscTrash className="size-3" /></button>
            </>} />
        ))}
      </div>
      {/* Bottom */}
      <div className="p-2 border-t shrink-0">
        <Button variant="outline" size="xs" onClick={openWorkspace} className="w-full text-micro gap-1.5"><VscFolderOpened className="size-3" /> Open Workspace</Button>
      </div>
    </div>
  );
}
