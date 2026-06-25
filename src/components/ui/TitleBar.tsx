import * as React from 'react';
import { FluentSidebarLeft, FluentSidebarRight } from '@react-symbols/icons';
import { IoArrowBack, IoArrowForward } from 'react-icons/io5';
import { VscCloudDownload, VscSync } from 'react-icons/vsc';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { selectConv as selectConvHelper } from '@/lib/selectConv';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { el } from '@/lib/electron';

export interface TitleBarProps { title?: string; className?: string; onToggleLeftSidebar?: () => void; onToggleRightSidebar?: () => void; rightSlot?: React.ReactNode; }
const isMac = navigator.userAgent.toLowerCase().includes('mac');

function UpdateButton() {
  const [status, setStatus] = React.useState<string>('idle');
  const [info, setInfo] = React.useState<string | undefined>();
  React.useEffect(() => { const unsub = el.onUpdateStatus((s, i) => { setStatus(s); setInfo(i); }); return unsub; }, []);
  if (status === 'ready' && !isMac) return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="xs" onClick={() => el.updateQuitAndInstall()}>
          <VscCloudDownload className="size-3 shrink-0" /><span>Restart & Update</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{info || 'Update downloaded — click to restart and install'}</TooltipContent>
    </Tooltip>
  );
  if (status === 'available' && isMac) return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="xs" onClick={() => el.updateOpenReleases()}>
          <VscCloudDownload className="size-3 shrink-0" /><span>Update v{info}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Open releases page and download the latest version</TooltipContent>
    </Tooltip>
  );
  if (status === 'downloading' && !isMac) return (
    <span className="flex items-center gap-1 text-xs text-foreground/40 px-2">
      <VscSync className="size-3 animate-spin" /><span>Downloading…</span>
    </span>
  );
  return null;
}

export function TitleBar({ title = 'Orch Code', className = '', onToggleLeftSidebar, onToggleRightSidebar, rightSlot }: TitleBarProps) {
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const { workspaces, homeConversations, wsConversations } = useWorkspacesStore();
  const allConvs = [...homeConversations, ...workspaces.flatMap(w => wsConversations[w.id] || [])];
  const currentIndex = allConvs.findIndex(c => c.id === activeConvId);
  const activeConv = allConvs[currentIndex];
  const displayTitle = activeConv ? activeConv.title : title;
  return (
    <div className={`relative h-9 min-h-9 max-h-9 w-full flex items-center justify-between border-b border-border/60 bg-sidebar select-none [-webkit-app-region:drag] ${isMac ? 'pl-20 pr-3' : 'pl-3 pr-36'} ${className}`}>
      <title>OrchCode — {displayTitle}</title>
      <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        {onToggleLeftSidebar && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onToggleLeftSidebar} className="text-foreground/40 hover:text-foreground/80"><FluentSidebarLeft className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom">Toggle Sidebar</TooltipContent></Tooltip>
        )}
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" disabled={currentIndex <= 0} onClick={() => currentIndex > 0 && selectConvHelper(allConvs[currentIndex - 1].id, allConvs[currentIndex - 1].workspaceId)} className="text-foreground/40 hover:text-foreground/80"><IoArrowBack className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom">Previous</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" disabled={currentIndex === -1 || currentIndex >= allConvs.length - 1} onClick={() => currentIndex !== -1 && currentIndex < allConvs.length - 1 && selectConvHelper(allConvs[currentIndex + 1].id, allConvs[currentIndex + 1].workspaceId)} className="text-foreground/40 hover:text-foreground/80"><IoArrowForward className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom">Next</TooltipContent></Tooltip>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 text-xs font-medium text-foreground/40 truncate max-w-xs text-center pointer-events-none">{displayTitle}</div>
      <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
        <UpdateButton />
        {onToggleRightSidebar && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onToggleRightSidebar} className="text-foreground/40 hover:text-foreground/80"><FluentSidebarRight className="size-3.5" /></Button></TooltipTrigger><TooltipContent side="bottom">Toggle Panel</TooltipContent></Tooltip>
        )}
        {rightSlot}
      </div>
    </div>
  );
}
