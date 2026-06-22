import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { VsFolder, VsTerminal, VsSearch, VsGlobe, VsSymbolFile, VsChevronRight, VsChevronDown } from 'solid-icons/vs';
import { fileIcon } from './FileTree';
import { setFileToOpen } from '../store';
export type LiveTool = { id: string; name: string; args: unknown; status: 'pending'|'success'|'error' };
const base = (p: string) => (p ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
type ToolKind = 'read'|'edit'|'write'|'run'|'search'|'web'|'generate'|'dir'|'other';
function toolKind(name: string): ToolKind {
  switch (name) {
    case 'view_file': return 'read';
    case 'list_dir': return 'dir';
    case 'multi_replace_file_content': return 'edit';
    case 'write_to_file': return 'write';
    case 'run_command': return 'run';
    case 'search_workspace': return 'search';
    case 'search_web': return 'web';
    case 'generate_image': return 'generate';
    default: return 'other';
  }
}
function summarize(tools: LiveTool[]): string {
  const c: Partial<Record<ToolKind, number>> = {};
  for (const t of tools) { const k = toolKind(t.name); c[k] = (c[k] ?? 0) + 1; }
  const p: string[] = [];
  if (c.read)     p.push(`Read ${c.read} ${c.read === 1 ? 'file' : 'files'}`);
  if (c.dir)      p.push(`Listed ${c.dir} ${c.dir === 1 ? 'dir' : 'dirs'}`);
  if (c.edit)     p.push(`Edited ${c.edit} ${c.edit === 1 ? 'file' : 'files'}`);
  if (c.write)    p.push(`Created ${c.write} ${c.write === 1 ? 'file' : 'files'}`);
  if (c.run)      p.push(`Ran ${c.run} ${c.run === 1 ? 'command' : 'commands'}`);
  if (c.search)   p.push(`Searched ${c.search} ${c.search === 1 ? 'time' : 'times'}`);
  if (c.web)      p.push(`Searched web`);
  if (c.generate) p.push(`Generated image`);
  if (c.other)    p.push(`Used ${c.other} ${c.other === 1 ? 'tool' : 'tools'}`);
  return p.join(' · ');
}
type ViewFileArgs      = { absolute_path: string; start_line?: number; end_line?: number };
type ListDirArgs       = { directory_path: string };
type WriteFileArgs     = { target_file: string; code_content: string };
type MultiReplaceArgs  = { target_file: string; replacement_chunks: { target_content: string; replacement_content: string }[] };
type RunCmdArgs        = { command_line: string };
type SearchArgs        = { query: string };
type GenImageArgs      = { prompt: string };
function diffStats(chunks: { target_content: string; replacement_content: string }[]) {
  let added = 0, removed = 0;
  for (const c of chunks) {
    removed += c.target_content.split('\n').filter(Boolean).length;
    added += c.replacement_content.split('\n').filter(Boolean).length;
  }
  return { added, removed };
}
interface ToolRowProps { tool: LiveTool; onDiffClick: (t: LiveTool) => void }
function ToolRow(props: ToolRowProps) {
  const a = () => props.tool.args as any;
  const k = () => toolKind(props.tool.name);
  function rowIcon() {
    const SZ = 12;
    switch (props.tool.name) {
      case 'view_file':           return fileIcon(base((a() as ViewFileArgs).absolute_path) || 'file', SZ);
      case 'write_to_file':
      case 'multi_replace_file_content': return fileIcon(base((a() as WriteFileArgs).target_file) || 'file', SZ);
      case 'list_dir':            return <VsFolder size={SZ} color="#dcb67a"/>;
      case 'run_command':         return <VsTerminal size={SZ} color="var(--text-faint)"/>;
      case 'search_workspace':    return <VsSearch size={SZ} color="var(--text-faint)"/>;
      case 'search_web':          return <VsGlobe size={SZ} color="var(--text-faint)"/>;
      default:                    return <VsSymbolFile size={SZ} color="var(--text-faint)"/>;
    }
  }
  function verb() {
    switch (props.tool.name) {
      case 'view_file':                  return 'Read';
      case 'list_dir':                   return 'Listed';
      case 'multi_replace_file_content': return 'Edited';
      case 'write_to_file':              return 'Created';
      case 'run_command':                return 'Ran';
      case 'search_workspace':           return 'Searched';
      case 'search_web':                 return 'Searched web';
      case 'generate_image':             return 'Generated image';
      default: return props.tool.name.replace(/_/g, ' ');
    }
  }
  function label() {
    switch (props.tool.name) {
      case 'view_file': {
        const ar = a() as ViewFileArgs;
        const file = base(ar.absolute_path);
        const s = ar.start_line != null ? Number(ar.start_line) : null;
        const e = ar.end_line   != null ? Number(ar.end_line)   : null;
        const range = s != null ? ` :${s}${e != null && e !== s ? `–${e}` : ''}` : '';
        return file + range;
      }
      case 'list_dir': return base((a() as ListDirArgs).directory_path) + '/';
      case 'multi_replace_file_content': {
        const ar = a() as MultiReplaceArgs;
        const { added, removed } = diffStats(ar.replacement_chunks ?? []);
        return `${base(ar.target_file)}  +${added} −${removed}`;
      }
      case 'write_to_file': {
        const ar = a() as WriteFileArgs;
        return `${base(ar.target_file)}  +${(ar.code_content ?? '').split('\n').length}`;
      }
      case 'run_command':       return (a() as RunCmdArgs).command_line?.slice(0, 60) ?? '';
      case 'search_workspace':  return `"${((a() as SearchArgs).query ?? '').slice(0, 50)}"`;
      case 'search_web':        return `"${((a() as SearchArgs).query ?? '').slice(0, 50)}"`;
      case 'generate_image':    return ((a() as GenImageArgs).prompt ?? '').slice(0, 50);
      default: return '';
    }
  }
  const clickable = () => ['read','write','edit','dir'].includes(k());
  function handleClick() {
    if (k() === 'edit') { props.onDiffClick(props.tool); return; }
    const ar = a();
    const path = ar.absolute_path ?? ar.target_file ?? ar.directory_path ?? '';
    if (path) setFileToOpen(String(path));
  }
  return (
    <div class={`ta-row${clickable() ? ' ta-row-link' : ''}`} onClick={clickable() ? handleClick : undefined}>
      <span class="ta-row-icon">{rowIcon()}</span>
      <span class="ta-row-verb">{verb()}</span>
      <span class="ta-row-label">{label()}</span>
    </div>
  );
}
function DiffModal(props: { tool: LiveTool; onClose: () => void }) {
  const ar = () => props.tool.args as MultiReplaceArgs;
  const chunks = () => ar().replacement_chunks ?? [];
  const filename = () => base(ar().target_file ?? 'file');
  return (
    <div class="diff-backdrop" onClick={props.onClose}>
      <div class="diff-modal" onClick={e => e.stopPropagation()}>
        <div class="diff-header">
          <span class="diff-title">{fileIcon(filename(), 12)} {filename()}</span>
          <button class="icon-btn diff-close" onClick={props.onClose}>✕</button>
        </div>
        <div class="diff-body">
          <For each={chunks()}>{(chunk, ci) => (
            <div class="diff-chunk">
              <div class="diff-chunk-label">Chunk {ci() + 1}</div>
              <For each={chunk.target_content.split('\n')}>{(line, li) => (
                <div class="diff-line diff-removed">
                  <span class="diff-ln">{li() + 1}</span>
                  <span class="diff-sign">−</span>
                  <span class="diff-text">{line}</span>
                </div>
              )}</For>
              <For each={chunk.replacement_content.split('\n')}>{(line, li) => (
                <div class="diff-line diff-added">
                  <span class="diff-ln">{li() + 1}</span>
                  <span class="diff-sign">+</span>
                  <span class="diff-text">{line}</span>
                </div>
              )}</For>
            </div>
          )}</For>
        </div>
      </div>
    </div>
  );
}
interface Props { tools: LiveTool[]; active?: boolean }
export default function ToolActivity(props: Props) {
  const [manualOpen, setManualOpen] = createSignal(false);
  const [diffTool, setDiffTool] = createSignal<LiveTool | null>(null);
  const isOpen = () => props.active || manualOpen();
  const visibleTools = () => props.active ? props.tools.slice(-3) : props.tools;
  return (
    <>
    <div class="ta-wrap">
      <button class={`ta-summary${props.active ? ' tool-active' : ''}`} onClick={() => setManualOpen(o => !o)} aria-expanded={isOpen()}>
        <span>{summarize(props.tools)}</span>
        <span class="ta-chevron">{isOpen() ? <VsChevronDown size={10}/> : <VsChevronRight size={10}/>}</span>
      </button>
      <Show when={isOpen()}>
        <div class="ta-dropdown">
          <For each={visibleTools()}>{tool => <ToolRow tool={tool} onDiffClick={t => setDiffTool(t)}/>}</For>
        </div>
      </Show>
    </div>
    <Show when={diffTool()}>
      <Portal>
        <DiffModal tool={diffTool()!} onClose={() => setDiffTool(null)}/>
      </Portal>
    </Show>
    </>
  );
}
