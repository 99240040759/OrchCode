import { useUIStore } from '@/store/ui';
import path from 'path-browserify';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import FileViewer from './FileViewer';
import FileDiffViewer from './FileDiffViewer';
import TerminalPane from './TerminalPane';
import BrowserPane from './BrowserPane';
import { VscGlobe, VscTerminal, VscChromeClose } from 'react-icons/vsc';
import { LuMaximize2, LuMinimize2 } from 'react-icons/lu';
import { FileIcon } from '@/components/ui/FileIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VscSymbolColor } from 'react-icons/vsc';

export default function ArtifactPanel() {
  const { getConvUI, setActiveTabId, closeTab, setArtifactMaximized, toggleTabViewMode } = useUIStore();
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const conv = useConversationsStore(s => activeConvId ? s.convs[activeConvId] : undefined);
  const wsPath = conv?.workspaceId ? workspaces.find(w => w.id === conv.workspaceId)?.path : undefined;
  if (!activeConvId) return <div className="h-full flex items-center justify-center text-xs text-foreground/30">No active conversation</div>;
  const { activeTabId, openTabs, artifactMaximized } = getConvUI(activeConvId);
  return (
    <Tabs value={activeTabId} onValueChange={(v) => setActiveTabId(activeConvId, v)} className="h-full flex flex-col bg-background gap-0 border-none p-0">
      <div className="px-1.5 py-1 border-b border-border/60 flex items-center justify-between shrink-0 overflow-hidden gap-1">
        <TabsList className="flex-1 overflow-x-auto overflow-y-hidden gap-0.5 w-auto h-7 justify-start">
          {[
            { id: 'browser', icon: <VscGlobe className="size-3" />, label: 'Browser' },
            { id: 'terminal', icon: <VscTerminal className="size-3" />, label: 'Terminal' },
          ].map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs px-2.5 h-6 gap-1">
              {tab.icon}{tab.label}
            </TabsTrigger>
          ))}
          {openTabs.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="group text-xs px-2 h-6 gap-1 max-w-36">
              <span className="relative size-3 shrink-0 cursor-pointer" onClick={e => { e.stopPropagation(); closeTab(activeConvId, tab.id); }}>
                <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0">
                  {tab.type === 'image' || tab.content?.startsWith('data:image') ? <VscSymbolColor className="size-3" /> : <FileIcon fileName={path.basename(tab.path.replace(/\\/g, '/'))} className="size-3" />}
                </span>
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-foreground/40 hover:text-foreground/80">
                  <VscChromeClose className="size-2.5" />
                </span>
              </span>
              <span className="truncate">{tab.title}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => setArtifactMaximized(activeConvId, !artifactMaximized)} className="text-foreground/35 hover:text-foreground/70 shrink-0">
              {artifactMaximized ? <LuMinimize2 className="size-3" /> : <LuMaximize2 className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{artifactMaximized ? 'Restore' : 'Maximize'}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <TabsContent value="browser" className="h-full w-full m-0 data-[state=active]:block data-[state=inactive]:hidden"><BrowserPane convId={activeConvId} /></TabsContent>
        <TabsContent value="terminal" className="h-full w-full m-0 data-[state=active]:block data-[state=inactive]:hidden"><TerminalPane convId={activeConvId} cwd={wsPath} /></TabsContent>
        {openTabs.map(tab => {
          const hasDiff = !!(tab.original && tab.modified);
          const onToggle = () => toggleTabViewMode(activeConvId, tab.id);
          return (
            <TabsContent key={tab.id} value={tab.id} className="h-full w-full m-0 overflow-hidden data-[state=active]:block data-[state=inactive]:hidden">
              {tab.type === 'image' || tab.content?.startsWith('data:image') ? (
                <div className="h-full w-full flex items-center justify-center bg-background p-4 overflow-auto"><img src={tab.content} alt={tab.title} className="max-w-full max-h-full object-contain rounded-md" /></div>
              ) : tab.viewMode === 'diff' ? (
                <FileDiffViewer filePath={tab.path} original={tab.original || ''} modified={tab.modified || ''} hasDiff={hasDiff} viewMode={tab.viewMode} onToggleDiff={onToggle} />
              ) : (
                <FileViewer filePath={tab.path} content={tab.content || tab.modified || ''} startLine={tab.startLine || 1} endLine={tab.endLine || (tab.content || tab.modified || '').split('\n').length} hasDiff={hasDiff} viewMode={tab.viewMode} onToggleDiff={onToggle} />
              )}
            </TabsContent>
          );
        })}
      </div>
    </Tabs>
  );
}
