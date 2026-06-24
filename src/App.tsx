import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TitleBar } from '@/components/ui/TitleBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import Onboarding from '@/components/Onboarding';
import Sidebar from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import ArtifactPanel from '@/components/ArtifactPanel';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { useUIStore, DEFAULT_CONV_UI } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useModelsStore } from '@/store/models';
import { VscSignOut } from 'react-icons/vsc';
import { el } from '@/lib/electron';
import { pushChunk, registerFlusher } from '@/lib/streamFlusher';
import type { AgentChunk, BudgetInfo } from '@/ipc/types';
const hash = window.location.hash;
function useGlobalAgentPort() {
  useEffect(() => {
    const cleanup = el.onAgentPort((convId: string) => {
      useConversationsStore.getState().setAgentReady(convId);
      let stopFlusher: (() => void) | null = null;
      el.onAgentMessage(convId, (msg: AgentChunk) => {
        const s = useConversationsStore.getState();
        if (msg.type === 'iter_start') { if (!stopFlusher) stopFlusher = registerFlusher(convId); s.startIteration(convId, msg.messageId); }
        else if (msg.type === 'chunk') pushChunk(convId, msg.delta, msg.tokenCount, msg.messageId);
        else if (msg.type === 'tool_call') s.addToolCall(convId, { id: msg.toolCall.id, name: msg.toolCall.name, input: msg.toolCall.input });
        else if (msg.type === 'tool_result') s.updateToolCall(convId, msg.toolCallId, { output: msg.result, ...msg.meta });
        else if (msg.type === 'done') { s.finalizeStream(convId); if (stopFlusher) { stopFlusher(); stopFlusher = null; } }
        else if (msg.type === 'db:tokens') s.setTokenCount(convId, msg.count);
        else if (msg.type === 'summary') s.replaceWithSummary(convId, msg.summaryMsg);
        else if (msg.type === 'error') { s.cancelStream(convId); if (stopFlusher) { stopFlusher(); stopFlusher = null; } console.error('[Agent Error]', msg.error); }
      });
    });
    return cleanup;
  }, []);
}
function UserMenu() {
  const { user, accessToken, clearSession } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<{ lifetimeTokens: number; conversationCount: number; messageCount: number } | null>(null);
  const [budget, setBudget] = useState<BudgetInfo | null>(null);
  useEffect(() => {
    if (!open) return;
    el.getStats().then(setStats).catch(() => {});
    if (accessToken) el.getBudget(accessToken).then(setBudget).catch(() => {});
  }, [open, accessToken]);
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  const budgetPct = budget ? Math.min((budget.cost_usd / budget.limit_usd) * 100, 100) : 0;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-2xs font-semibold text-primary hover:bg-primary/30 transition-colors shrink-0 select-none overflow-hidden" id="user-menu-btn">
          {user?.avatarUrl ? <img src={user.avatarUrl} className="w-5 h-5 rounded-full object-cover block" alt="avatar" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} /> : initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="px-3 py-2.5 flex items-center gap-2.5 border-b border-border">
          <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0 overflow-hidden">
            {user?.avatarUrl ? <img src={user.avatarUrl} className="size-7 rounded-full object-cover" alt="avatar" /> : initials}
          </div>
          <div className="min-w-0"><p className="text-xs font-medium truncate">{user?.email}</p></div>
        </div>
        {budget && (
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Monthly Budget</p>
            <div className="flex justify-between text-mini text-muted-foreground mb-1">
              <span>${budget.cost_usd.toFixed(4)} used</span><span>${budget.limit_usd.toFixed(2)} limit</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${budgetPct > 90 ? 'bg-red-500' : budgetPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${budgetPct}%` }} />
            </div>
            <p className="text-micro text-muted-foreground mt-1">Remaining: <span className="text-foreground font-mono">${budget.remaining.toFixed(4)}</span> · resets {budget.period}-01</p>
          </div>
        )}
        {stats && (
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Usage</p>
            <div className="grid grid-cols-3 gap-2">
              {[{ l: 'Tokens', v: stats.lifetimeTokens.toLocaleString() }, { l: 'Convos', v: stats.conversationCount.toLocaleString() }, { l: 'Messages', v: stats.messageCount.toLocaleString() }].map(s => (
                <div key={s.l} className="bg-muted/30 rounded p-1.5 flex flex-col gap-0.5">
                  <span className="text-micro text-muted-foreground">{s.l}</span>
                  <span className="font-mono text-mini font-semibold">{s.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="p-1">
          <button id="signout-menu-item" onClick={async () => { setOpen(false); await el.signOut(); clearSession(); }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-sm transition-colors">
            <VscSignOut className="size-3.5" /> Sign out
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export default function App() {
  useGlobalAgentPort();
  const { setSession, clearSession, isLoggedIn } = useAuthStore();
  const setModels = useModelsStore(s => s.setModels);
  const [authChecked, setAuthChecked] = useState(false);
  const { sidebarOpen, setSidebarOpen, setArtifactOpen } = useUIStore();
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const conv = useConversationsStore(s => s.activeConvId ? s.convs[s.activeConvId] : undefined);
  // Narrow selector — only re-renders when THIS conv's UI changes
  const activeConvUI = useUIStore(s => activeConvId ? (s.convUI[activeConvId] ?? DEFAULT_CONV_UI) : DEFAULT_CONV_UI);
  const { artifactOpen, artifactMaximized } = activeConvUI;
  useEffect(() => {
    const handleSession = async (s: any) => {
      setSession(s);
      try { const models = await el.fetchModels(s.accessToken); setModels(models); } catch (e) { console.error('[App] Models fetch failed:', e); }
    };
    (async () => { const stored = await el.loadStoredSession(); if (stored) await handleSession(stored); setAuthChecked(true); })();
    const cleanup = el.onSessionReceived(async (s) => { if (s) await handleSession(s); });
    const cleanupTitle = el.onConvTitleUpdated((convId: string, title: string) => { useWorkspacesStore.getState().updateConversationTitle(convId, title); });
    return () => { cleanup(); cleanupTitle(); };
  }, []);
  const wsPath = useWorkspacesStore(s => { const id = conv?.workspaceId; return id ? s.workspaces.find(w => w.id === id)?.path || null : null; });
  if (!authChecked) return (
    <TooltipProvider><div className="h-dvh w-dvw flex items-center justify-center bg-background"><Spinner className="size-5" /></div></TooltipProvider>
  );
  if (hash === '#onboarding' || !isLoggedIn) return (
    <TooltipProvider><div className="h-dvh w-dvw flex flex-col bg-background text-foreground font-sans antialiased overflow-hidden select-none">
      <TitleBar title="Welcome to Orch Code" />
      <div className="flex-1 overflow-hidden"><Onboarding /></div>
    </div></TooltipProvider>
  );
  return (
    <TooltipProvider>
      <div className="flex h-dvh w-dvw flex-col bg-background text-foreground font-sans antialiased overflow-hidden select-none">
        <TitleBar title="Orch Code" onToggleLeftSidebar={() => setSidebarOpen(!sidebarOpen)} onToggleRightSidebar={() => activeConvId && setArtifactOpen(activeConvId, !artifactOpen)} rightSlot={<UserMenu />} />
        <div className="flex-1 flex w-full overflow-hidden">
          {sidebarOpen && <Sidebar />}
          <div className="flex-1 h-full overflow-hidden relative">
            {artifactMaximized && artifactOpen ? (
              <ArtifactPanel />
            ) : activeConvId ? (
              artifactOpen ? (
                <ResizablePanelGroup orientation="horizontal">
                  <ResizablePanel defaultSize="40%" minSize="25%" maxSize="75%">
                    <ChatPanel convId={activeConvId} workspaceId={conv?.workspaceId || null} workspacePath={wsPath} />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel minSize="25%"><ArtifactPanel /></ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <ChatPanel convId={activeConvId} workspaceId={conv?.workspaceId || null} workspacePath={wsPath} />
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <div className="text-5xl opacity-20">✦</div>
                <p className="text-sm">Select or create a conversation</p>
                <p className="text-xs opacity-50">Open a workspace from the sidebar to scope your work</p>
              </div>
            )}
          </div>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
