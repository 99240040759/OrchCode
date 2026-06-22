import { createSignal, onMount, onCleanup, Show, createEffect, For } from 'solid-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Breadcrumbs } from '@kobalte/core/breadcrumbs';
import { terminalCreate, terminalWrite, terminalResize, terminalClose, onTerminalData, fileRead } from './api';
import { artifactTab, setArtifactTab, filesSidebarOpen, setFilesSidebarOpen, workspacePath, isDark, fileToOpen, setFileToOpen } from './store';
import { colors } from './theme';
import Tabs from './components/Tabs';
import FileTree from './components/FileTree';
import CodeEditor from './components/CodeEditor';
import { VsTerminal, VsFiles, VsLayoutSidebarRight, VsLayoutSidebarRightOff, VsChevronRight } from 'solid-icons/vs';
const TERM_ID = 'main';
function termTheme(dark: boolean) {
  return dark ? {
    background: colors.pageDark, foreground: colors.textPrimDark,
    cursor: colors.creamDark, selectionBackground: 'rgba(239,227,210,0.2)',
    black:'#1a1816', red:'#f87171', green:'#4ade80', yellow:'#fbbf24',
    blue:'#60a5fa', magenta:'#c084fc', cyan:'#34d399', white:'#f0ede8',
    brightBlack:'#6b6560', brightRed:'#fca5a5', brightGreen:'#86efac',
    brightYellow:'#fde68a', brightBlue:'#93c5fd', brightMagenta:'#e879f9',
    brightCyan:'#6ee7b7', brightWhite:'#ffffff',
  } : {
    background: colors.pageLight, foreground: colors.textPrimLight,
    cursor: colors.cream, selectionBackground: 'rgba(0,0,0,0.12)',
    black:'#1a1815', red:'#dc2626', green:'#16a34a', yellow:'#ca8a04',
    blue:'#2563eb', magenta:'#7c3aed', cyan:'#0891b2', white:'#4b5563',
    brightBlack:'#6b7280', brightRed:'#ef4444', brightGreen:'#22c55e',
    brightYellow:'#eab308', brightBlue:'#3b82f6', brightMagenta:'#8b5cf6',
    brightCyan:'#06b6d4', brightWhite:'#111827',
  };
}
export default function Artifact() {
  let termRef!: HTMLDivElement;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObs: ResizeObserver | null = null;
  let unlistenTermData: (() => void) | null = null;
  let lastTermWs: string | null = null;
  let termReady = false;
  const [openFile, setOpenFile] = createSignal<{ path: string; content: string } | null>(null);
  onMount(() => createTerminal(workspacePath() ?? undefined));
  onCleanup(() => { resizeObs?.disconnect(); term?.dispose(); unlistenTermData?.(); terminalClose(TERM_ID).catch(() => {}); });
  createEffect(() => { if (term) term.options.theme = termTheme(isDark()); });
  createEffect(() => { const p = fileToOpen(); if (p) { setFileToOpen(null); setArtifactTab('explorer'); openFileInEditor(p); } });
  createEffect(() => { if (artifactTab() === 'terminal') requestAnimationFrame(() => { fitAddon?.fit(); if (term) terminalResize(TERM_ID, term.cols, term.rows).catch(() => {}); }); });
  // Terminal reacts to workspace changes from appState — guaranteed consistent
  createEffect(() => {
    const path = workspacePath();
    if (!termReady) return;
    if (path === lastTermWs) return;
    lastTermWs = path;
    setOpenFile(null);
    if (path) recreateTerminal(path);
  });
  async function recreateTerminal(cwd: string) {
    unlistenTermData?.(); unlistenTermData = null; resizeObs?.disconnect();
    term?.dispose(); await terminalClose(TERM_ID).catch(() => {});
    createTerminal(cwd);
  }
  function createTerminal(cwd?: string) {
    lastTermWs = workspacePath();
    term = new Terminal({ fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace", fontSize: 13, lineHeight: 1.5, cursorBlink: true, theme: termTheme(isDark()), allowTransparency: false });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon); term.loadAddon(new WebLinksAddon());
    term.open(termRef);
    requestAnimationFrame(() => fitAddon?.fit());
    terminalCreate(TERM_ID, term.cols, term.rows, cwd).catch(e => console.error('[Artifact] terminalCreate:', e));
    term.onData(data => terminalWrite(TERM_ID, data).catch(() => {}));
    onTerminalData(TERM_ID, data => term?.write(data)).then(fn => { unlistenTermData = fn; });
    resizeObs = new ResizeObserver(() => { fitAddon?.fit(); if (term) terminalResize(TERM_ID, term.cols, term.rows).catch(() => {}); });
    resizeObs.observe(termRef);
    termReady = true;
  }
  async function openFileInEditor(path: string) {
    try {
      const res = await fileRead(path) as any;
      if (res && res.is_binary) {
        setOpenFile({ path, content: `[Binary File - ${res.mime_type || 'unknown'}]\nSize: ${res.size_bytes || 0} bytes` });
      } else if (res && typeof res.content === 'string') {
        setOpenFile({ path, content: res.content });
      }
    } catch {}
  }
  const pathParts = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-4);
  return (
    <div class="artifact-panel">
      <Tabs value={artifactTab()} onChange={v => setArtifactTab(v as 'terminal' | 'explorer')} class="artifact-tabs-root" listClass="artifact-tabs-list"
        items={[
          { value: 'terminal', label: <span class="artifact-tab-label"><VsTerminal size={13}/>Terminal</span> },
          { value: 'explorer', label: <span class="artifact-tab-label"><VsFiles size={13}/>Explorer</span> },
        ]}
        suffix={<Show when={artifactTab() === 'explorer'}>
          <button class="icon-btn" title={filesSidebarOpen() ? 'Hide file tree' : 'Show file tree'} onClick={() => setFilesSidebarOpen(o => !o)}>
            <Show when={filesSidebarOpen()} fallback={<VsLayoutSidebarRight size={14}/>}><VsLayoutSidebarRightOff size={14}/></Show>
          </button>
        </Show>}
      >
        <div class="artifact-content">
          <div ref={termRef} class="terminal-wrap" style={{ display: artifactTab() === 'terminal' ? 'flex' : 'none' }}/>
          <Show when={artifactTab() === 'explorer'}>
            <div class="explorer-split">
              <div class="explorer-editor">
                <Show when={openFile()} fallback={<div class="explorer-empty"><VsFiles size={32} style={{ opacity: '0.2' }}/><span>Select a file to open</span></div>}>
                  <div class="explorer-editor-tab">
                    <Breadcrumbs>
                      <ol class="bc-list"><For each={pathParts(openFile()!.path)}>{(part, i) => (
                        <li class="bc-item">
                          <Breadcrumbs.Link class={`bc-link${i() === pathParts(openFile()!.path).length - 1 ? ' bc-current' : ''}`} aria-current={i() === pathParts(openFile()!.path).length - 1 ? 'page' : undefined}>{part}</Breadcrumbs.Link>
                          <Show when={i() < pathParts(openFile()!.path).length - 1}><Breadcrumbs.Separator class="bc-sep"><VsChevronRight size={10}/></Breadcrumbs.Separator></Show>
                        </li>
                      )}</For></ol>
                    </Breadcrumbs>
                  </div>
                  <div class="explorer-editor-body"><CodeEditor content={openFile()!.content} filePath={openFile()!.path} dark={isDark()}/></div>
                </Show>
              </div>
              <Show when={filesSidebarOpen()}>
                <div class="explorer-tree-panel">
                  <div class="explorer-tree-header">Files</div>
                  <div class="explorer-tree-body"><FileTree onSelect={openFileInEditor}/></div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Tabs>
    </div>
  );
}
