import { useState, useEffect, useRef, useCallback } from "react";
import { VscArrowLeft, VscArrowRight, VscRefresh, VscSearch, VscChromeClose, VscChevronDown, VscChevronUp } from 'react-icons/vsc';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { el } from '@/lib/electron';
import { useUIStore } from '@/store/ui';
interface BrowserState { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; }
export default function BrowserPane({ convId }: { convId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>({ url: 'https://www.google.com', title: '', loading: true, canGoBack: false, canGoForward: false });
  const [inputUrl, setInputUrl] = useState('https://www.google.com');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResult, setSearchResult] = useState({ active: 0, total: 0 });
  const sidebarOpen = useUIStore(s => s.sidebarOpen);
  // Update inputUrl from state only when user isn't focused on it
  const inputFocused = useRef(false);
  useEffect(() => { if (!inputFocused.current) setInputUrl(state.url); }, [state.url]);
  // Position the WebContentsView over our div
  const updateBounds = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    el.browserSetBounds(convId, { x: rect.left, y: rect.top, width: rect.width, height: Math.max(rect.height, 100) });
  }, [convId]);
  // Re-sync bounds whenever sidebar/panel layout shifts
  useEffect(() => { requestAnimationFrame(updateBounds); }, [sidebarOpen, updateBounds]);
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    el.browserShow(convId, { x: rect.left, y: rect.top, width: rect.width, height: Math.max(rect.height, 100) });
    // Listen for browser state from main
    const cleanup = el.onBrowserState((s) => {
      if (s.convId !== convId) return;
      setState(s);
    });
    // Listen for find-in-page results
    const cleanupFind = el.onBrowserFindResult?.((cId, active, total) => {
      if (cId === convId) setSearchResult({ active, total });
    });
    // Track resize — repositions the view
    const ro = new ResizeObserver(updateBounds);
    ro.observe(containerRef.current);
    // Track scroll/layout shifts
    window.addEventListener('resize', updateBounds);
    return () => {
      el.browserHide();
      cleanup();
      cleanupFind?.();
      ro.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [convId, updateBounds]);
  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); setSearchOpen(v => !v); }
      if (e.key === 'Escape' && searchOpen) { setSearchOpen(false); setSearchText(''); el.browserStopFind(convId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [convId, searchOpen]);
  const navigate = useCallback((val: string) => {
    let t = val.trim();
    if (!t) return;
    if (!/^(https?|file):\/\//i.test(t)) t = t.includes('.') && !t.includes(' ') ? 'https://' + t : 'https://www.google.com/search?q=' + encodeURIComponent(t);
    el.browserNavigate(convId, t);
    setInputUrl(t);
  }, [convId]);
  const onSearch = useCallback((txt: string) => {
    setSearchText(txt);
    if (txt) el.browserFindInPage(convId, txt);
    else { el.browserStopFind(convId); setSearchResult({ active: 0, total: 0 }); }
  }, [convId]);
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="h-8 min-h-8 px-2 border-b border-border/60 flex items-center gap-1.5 bg-sidebar shrink-0 select-none">
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" disabled={!state.canGoBack} onClick={() => el.browserBack(convId)} className="text-foreground/35 hover:text-foreground/70"><VscArrowLeft className="size-3" /></Button>
        </TooltipTrigger><TooltipContent side="bottom">Back</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" disabled={!state.canGoForward} onClick={() => el.browserForward(convId)} className="text-foreground/35 hover:text-foreground/70"><VscArrowRight className="size-3" /></Button>
        </TooltipTrigger><TooltipContent side="bottom">Forward</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={() => state.loading ? el.browserStop(convId) : el.browserReload(convId)} className="text-foreground/35 hover:text-foreground/70">
            {state.loading ? <VscChromeClose className="size-3" /> : <VscRefresh className="size-3" />}
          </Button>
        </TooltipTrigger><TooltipContent side="bottom">{state.loading ? 'Stop' : 'Reload'}</TooltipContent></Tooltip>
        <div className="flex-1 relative">
          <input type="text" value={inputUrl} spellCheck={false}
            onChange={e => setInputUrl(e.target.value)}
            onFocus={() => { inputFocused.current = true; (document.activeElement as HTMLInputElement)?.select(); }}
            onBlur={() => { inputFocused.current = false; }}
            onKeyDown={e => e.key === 'Enter' && navigate(inputUrl)}
            className="w-full bg-white/4 border border-border/50 rounded px-2 py-0.5 text-xs outline-none text-foreground/70 focus:border-border focus:bg-white/6 transition-colors duration-100" />
        </div>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={() => setSearchOpen(v => !v)} className={searchOpen ? 'bg-white/8 text-foreground/80' : 'text-foreground/35 hover:text-foreground/70'}><VscSearch className="size-3" /></Button>
        </TooltipTrigger><TooltipContent side="bottom">Find in page</TooltipContent></Tooltip>
      </div>
      {/* Loading bar */}
      {state.loading && (
        <div className="h-0.5 w-full bg-muted/20 shrink-0 overflow-hidden">
          <div className="h-full bg-primary" style={{ animation: 'loadbar 1.5s ease-in-out infinite', width: '35%' }} />
        </div>
      )}
      {/* Find bar */}
      {searchOpen && (
        <div className="h-8 px-2 border-b border-border/60 flex items-center gap-1.5 bg-sidebar shrink-0">
          <input type="text" placeholder="Find…" value={searchText} autoFocus
            onChange={e => onSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') el.browserFindInPage(convId, searchText, { forward: !e.shiftKey, findNext: true }); }}
            className="flex-1 bg-white/4 border border-border/50 rounded px-2 py-0.5 outline-none text-xs focus:border-border transition-colors" />
          <span className="text-[11px] text-foreground/25 shrink-0 w-10 text-right tabular-nums">{searchResult.total > 0 ? `${searchResult.active}/${searchResult.total}` : '0/0'}</span>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => el.browserFindInPage(convId, searchText, { forward: false, findNext: true })} className="text-foreground/35 hover:text-foreground/70"><VscChevronUp className="size-3" /></Button>
          </TooltipTrigger><TooltipContent side="bottom">Prev</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => el.browserFindInPage(convId, searchText, { forward: true, findNext: true })} className="text-foreground/35 hover:text-foreground/70"><VscChevronDown className="size-3" /></Button>
          </TooltipTrigger><TooltipContent side="bottom">Next</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => { setSearchOpen(false); setSearchText(''); el.browserStopFind(convId); }} className="text-foreground/35 hover:text-foreground/70"><VscChromeClose className="size-3" /></Button>
          </TooltipTrigger><TooltipContent side="bottom">Close</TooltipContent></Tooltip>
        </div>
      )}
      {/* Transparent placeholder — WebContentsView is positioned over this in main process */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full bg-neutral-950" />
    </div>
  );
}
