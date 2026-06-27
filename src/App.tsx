import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { TitleBar } from '@/components/ui/TitleBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
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
import { startFlusher, stopFlusher, pushDelta } from '@/lib/streamFlusher';
import type { BudgetInfo } from '@/ipc/types';
const hash = window.location.hash;
function useGlobalAgentEvents() {
  useEffect(() => {
    startFlusher();
    const cleanup = el.onAgentEvent((convId, ev) => {
      const s = useConversationsStore.getState();
      if (ev.type === 'part.delta') pushDelta(convId, ev.messageId, ev.partId, ev.text);
      else if (ev.type === 'tokens') s.setTokenCount(convId, ev.context);
      else s.apply(convId, ev);
    });
    return () => { cleanup(); stopFlusher(); };
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
        <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/6 shrink-0 overflow-hidden" id="user-menu-btn">
          <Avatar className="size-5">
            <AvatarImage src={user?.avatarUrl} alt="avatar" />
            <AvatarFallback className="text-[10px] bg-primary/15 text-primary font-semibold">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-0">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-border/60">
          <Avatar className="size-6">
            <AvatarImage src={user?.avatarUrl} alt="avatar" />
            <AvatarFallback className="text-[10px] bg-primary/15 text-primary font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0"><p className="text-xs text-foreground/70 truncate">{user?.email}</p></div>
        </div>
        {budget && (
          <div className="px-3 py-2 border-b border-border/60">
            <p className="label-xs mb-1.5">Monthly Budget</p>
            <div className="flex justify-between text-[11px] text-foreground/40 mb-1">
              <span>${budget.cost_usd.toFixed(4)} used</span><span>${budget.limit_usd.toFixed(2)} limit</span>
            </div>
            <div className="h-1 bg-white/6 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${budgetPct > 90 ? 'bg-destructive' : budgetPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${budgetPct}%` }} />
            </div>
            <p className="text-[11px] text-foreground/30 mt-1">Remaining: <span className="text-foreground/60 font-mono">${budget.remaining.toFixed(4)}</span> · resets {budget.period}-01</p>
          </div>
        )}
        {stats && (
          <div className="px-3 py-2 border-b border-border/60">
            <p className="label-xs mb-1.5">Usage</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[{ l: 'Tokens', v: stats.lifetimeTokens.toLocaleString() }, { l: 'Convos', v: stats.conversationCount.toLocaleString() }, { l: 'Msgs', v: stats.messageCount.toLocaleString() }].map(s => (
                <div key={s.l} className="bg-white/4 rounded p-1.5 flex flex-col gap-0.5">
                  <span className="text-[11px] text-foreground/30">{s.l}</span>
                  <span className="font-mono text-xs text-foreground/70 font-medium">{s.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="p-1">
          <DropdownMenuItem id="signout-menu-item" onSelect={async () => { setOpen(false); await el.signOut(); clearSession(); }}
            variant="destructive" className="cursor-pointer">
            <VscSignOut className="size-3" /> Sign out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export default function App() {
  useGlobalAgentEvents();
  const { setSession, clearSession, isLoggedIn } = useAuthStore();
  const setModels = useModelsStore(s => s.setModels);
  const [authChecked, setAuthChecked] = useState(false);
  const sidebarOpen = useUIStore(s => s.sidebarOpen), setSidebarOpen = useUIStore(s => s.setSidebarOpen), setArtifactOpen = useUIStore(s => s.setArtifactOpen);
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
    <TooltipProvider><div className="h-dvh w-dvw flex flex-col bg-background text-foreground font-sans overflow-hidden select-none">
      <TitleBar title="Welcome to Orch Code" />
      <div className="flex-1 overflow-hidden"><Onboarding /></div>
    </div></TooltipProvider>
  );
  return (
    <TooltipProvider>
      <div className="flex h-dvh w-dvw flex-col bg-background text-foreground font-sans overflow-hidden select-none">
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
                    <ChatPanel key={activeConvId} convId={activeConvId} workspacePath={wsPath} />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel minSize="25%"><ArtifactPanel /></ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <ChatPanel key={activeConvId} convId={activeConvId} workspacePath={wsPath} />
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <div className="size-8 rounded-lg bg-white/4 flex items-center justify-center text-foreground/20 text-base mb-1">✦</div>
                <p className="text-xs text-foreground/40 font-medium">No conversation selected</p>
                <p className="text-[11px] text-foreground/20">Open the sidebar to start or continue a conversation</p>
              </div>
            )}
          </div>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
