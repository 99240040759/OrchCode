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
const isMac = typeof window !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');
function UpdateButton() {
  const [status, setStatus] = React.useState<string>('idle');
  const [info, setInfo] = React.useState<string | undefined>();
  React.useEffect(() => {
    const unsub = el.onUpdateStatus((s, i) => { setStatus(s); setInfo(i); });
    return unsub;
  }, []);
  if (status === 'ready' && !isMac) return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={() => el.updateQuitAndInstall()}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-foreground/10 hover:bg-foreground/15 text-foreground transition-colors font-medium">
          <VscCloudDownload className="size-3.5 shrink-0" />
          <span>Restart & Update</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{info || 'Update downloaded — click to restart and install'}</TooltipContent>
    </Tooltip>
  );
  if (status === 'available' && isMac) return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={() => el.updateOpenReleases()}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-foreground/10 hover:bg-foreground/15 text-foreground transition-colors font-medium">
          <VscCloudDownload className="size-3.5 shrink-0" />
          <span>Update v{info}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Click to open the releases page and download the latest version</TooltipContent>
    </Tooltip>
  );
  if (status === 'downloading' && !isMac) return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-2">
      <VscSync className="size-3.5 animate-spin" />
      <span>Downloading update…</span>
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
    <div className={`relative h-[36px] min-h-[36px] max-h-[36px] box-border w-full flex items-center justify-between border-b bg-muted/20 text-xs font-medium select-none ${isMac ? 'pl-[80px] pr-3' : 'pl-3 pr-[140px]'} ${className}`} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {onToggleLeftSidebar && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={onToggleLeftSidebar} className="text-muted-foreground"><FluentSidebarLeft className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Toggle Left Sidebar</TooltipContent></Tooltip>
        )}
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" disabled={currentIndex <= 0} onClick={() => currentIndex > 0 && selectConvHelper(allConvs[currentIndex - 1].id, allConvs[currentIndex - 1].workspaceId)} className="text-muted-foreground"><IoArrowBack className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Previous Conversation</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" disabled={currentIndex === -1 || currentIndex >= allConvs.length - 1} onClick={() => currentIndex !== -1 && currentIndex < allConvs.length - 1 && selectConvHelper(allConvs[currentIndex + 1].id, allConvs[currentIndex + 1].workspaceId)} className="text-muted-foreground"><IoArrowForward className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Next Conversation</TooltipContent></Tooltip>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 text-muted-foreground truncate max-w-[40%] text-center">{displayTitle}</div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <UpdateButton />
        {onToggleRightSidebar && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={onToggleRightSidebar} className="text-muted-foreground"><FluentSidebarRight className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Toggle Right Sidebar</TooltipContent></Tooltip>
        )}
        {rightSlot}
      </div>
    </div>
  );
}
