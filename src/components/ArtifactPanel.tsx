import { useUIStore } from '@/store/ui';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import FileViewer from './FileViewer';
import FileDiffViewer from './FileDiffViewer';
import TerminalPane from './TerminalPane';
import BrowserPane from './BrowserPane';
import { VscGlobe, VscTerminal, VscDiff, VscChromeClose, VscSymbolColor } from 'react-icons/vsc';
import { LuMaximize2, LuMinimize2 } from 'react-icons/lu';
import { FileIcon } from '@/components/ui/FileIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function ArtifactPanel() {
  const { getConvUI, setActiveTabId, closeTab, setArtifactMaximized } = useUIStore();
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const conv = useConversationsStore(s => activeConvId ? s.convs[activeConvId] : undefined);
  const wsPath = conv?.workspaceId ? workspaces.find(w => w.id === conv.workspaceId)?.path : undefined;
  if (!activeConvId) return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No active conversation</div>
  );
  const { activeTabId, openTabs, artifactMaximized } = getConvUI(activeConvId);
  return (
    <Tabs value={activeTabId} onValueChange={(v) => setActiveTabId(activeConvId, v)} className="h-full flex flex-col bg-background gap-0 border-none p-0">
      {/* Tab bar */}
      <div className="h-9 min-h-9 max-h-9 px-2 border-b flex items-center justify-between bg-muted/5 shrink-0 overflow-hidden">
        <TabsList className="flex-1 min-w-0 flex items-center justify-start gap-0.5 overflow-x-auto scrollbar-none h-full bg-transparent p-0 rounded-none border-none">
          {[
            { id: 'browser', icon: <VscGlobe className="size-4" />, label: 'Browser' },
            { id: 'terminal', icon: <VscTerminal className="size-4" />, label: 'Terminal' },
          ].map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="h-7 px-3 flex-none flex items-center gap-1.5 rounded-md text-xs transition-colors data-[state=active]:bg-muted data-[state=active]:text-foreground text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:shadow-none border-none">
              {tab.icon}{tab.label}
            </TabsTrigger>
          ))}
          {openTabs.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="group flex-none h-7 pl-2.5 pr-1 flex items-center justify-start gap-1.5 rounded-md text-xs transition-colors max-w-40 data-[state=active]:bg-muted data-[state=active]:text-foreground text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:shadow-none border-none">
              <span className="relative size-4 shrink-0 cursor-pointer" onClick={e => { e.stopPropagation(); closeTab(activeConvId, tab.id); }}>
                <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
                  {tab.type === 'diff' ? <VscDiff className="size-4" /> : tab.content?.startsWith('data:image') ? <VscSymbolColor className="size-4" /> : <FileIcon fileName={tab.path.split('/').pop() || tab.path} className="size-4" />}
                </span>
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                  <VscChromeClose className="size-3" />
                </span>
              </span>
              <span className="truncate">{tab.title}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => setArtifactMaximized(activeConvId, !artifactMaximized)} className="text-muted-foreground flex-none ml-1">
              {artifactMaximized ? <LuMinimize2 className="size-4" /> : <LuMaximize2 className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{artifactMaximized ? 'Restore' : 'Maximize'}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <TabsContent value="browser" className="h-full w-full m-0 data-[state=active]:block data-[state=inactive]:hidden"><BrowserPane convId={activeConvId} /></TabsContent>
        <TabsContent value="terminal" className="h-full w-full m-0 data-[state=active]:block data-[state=inactive]:hidden"><TerminalPane convId={activeConvId} cwd={wsPath} /></TabsContent>
        {openTabs.map(tab => (
          <TabsContent key={tab.id} value={tab.id} className="h-full w-full m-0 overflow-hidden data-[state=active]:block data-[state=inactive]:hidden">
            {tab.type === 'diff'
              ? <FileDiffViewer filePath={tab.path} original={tab.original || ''} modified={tab.modified || ''} />
              : tab.content?.startsWith('data:image')
                ? <div className="h-full w-full flex items-center justify-center bg-background p-4 overflow-auto"><img src={tab.content} alt={tab.title} className="max-w-full max-h-full object-contain rounded-lg" /></div>
                : <FileViewer filePath={tab.path} content={tab.content || ''} startLine={tab.startLine || 1} endLine={tab.endLine || (tab.content || '').split('\n').length} />}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
