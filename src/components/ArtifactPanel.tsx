import React from 'react';
import { useUIStore } from '@/store/ui';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import FileViewer from './FileViewer';
import FileDiffViewer from './FileDiffViewer';
import TerminalPane from './TerminalPane';
import BrowserPane from './BrowserPane';
import { VscGlobe, VscTerminal, VscDiff, VscChromeClose } from 'react-icons/vsc';
import { LuMaximize2, LuMinimize2 } from 'react-icons/lu';
import { FileIcon } from '@/components/ui/FileIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
export default function ArtifactPanel() {
  const { getConvUI, setActiveTabId, closeTab, artifactMaximized, setArtifactMaximized } = useUIStore();
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const conv = useConversationsStore(s => activeConvId ? s.convs.get(activeConvId) : undefined);
  const wsPath = conv?.workspaceId ? workspaces.find(w => w.id === conv.workspaceId)?.path : undefined;
  if (!activeConvId) return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No active conversation</div>
  );
  const { activeTabId, openTabs } = getConvUI(activeConvId);
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="h-9 min-h-[36px] max-h-[36px] px-2 border-b flex items-center justify-between bg-muted/5 shrink-0 overflow-hidden">
        <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none h-full">
          {[
            { id: 'browser', icon: <VscGlobe className="size-[15px]" />, label: 'Browser' },
            { id: 'terminal', icon: <VscTerminal className="size-[15px]" />, label: 'Terminal' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTabId(activeConvId, tab.id)} className={`h-7 px-3 flex-none flex items-center gap-1.5 rounded-md text-xs transition-colors ${activeTabId === tab.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              {tab.icon}{tab.label}
            </button>
          ))}
          {openTabs.map(tab => (
            <div key={tab.id} className="group flex-none">
              <button onClick={() => setActiveTabId(activeConvId, tab.id)} className={`h-7 pl-2.5 pr-1 flex items-center gap-1.5 rounded-md text-xs transition-colors max-w-[150px] ${activeTabId === tab.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
              <span className="relative size-[15px] shrink-0 cursor-pointer" onClick={e => { e.stopPropagation(); closeTab(activeConvId, tab.id); }}>
                <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
                  {tab.type === 'diff' ? <VscDiff className="size-[15px]" /> : <FileIcon fileName={tab.path} className="size-[15px]" />}
                </span>
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                  <VscChromeClose className="size-3" />
                </span>
              </span>
              <span className="truncate">{tab.title}</span>
              </button>
            </div>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => setArtifactMaximized(!artifactMaximized)} className="text-muted-foreground flex-none ml-1">
              {artifactMaximized ? <LuMinimize2 className="size-4" /> : <LuMaximize2 className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{artifactMaximized ? 'Restore' : 'Maximize'}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTabId === 'browser' && <BrowserPane convId={activeConvId} />}
        {activeTabId === 'terminal' && <TerminalPane convId={activeConvId} cwd={wsPath} />}
        {openTabs.map(tab => activeTabId === tab.id && (
          <div key={tab.id} className="h-full w-full overflow-hidden">
            {tab.type === 'diff'
              ? <FileDiffViewer filePath={tab.path} original={tab.original || ''} modified={tab.modified || ''} />
              : tab.content?.startsWith('data:image')
                ? <div className="h-full w-full flex items-center justify-center bg-background p-4 overflow-auto"><img src={tab.content} alt={tab.title} className="max-w-full max-h-full object-contain rounded-lg" /></div>
                : <FileViewer filePath={tab.path} content={tab.content || ''} startLine={tab.startLine || 1} endLine={tab.endLine || (tab.content || '').split('\n').length} />}
          </div>
        ))}
      </div>
    </div>
  );
}
