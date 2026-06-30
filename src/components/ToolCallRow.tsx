import { useUIStore } from '@/store/ui';
import path from 'path-browserify';
import { VscGlobe, VscTerminal, VscSearch, VscSymbolColor, VscBook } from 'react-icons/vsc';
import { FileIcon } from '@/components/ui/FileIcon';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import type { UIToolPart } from '@/ipc/types';

const basename = (p: any) => typeof p === 'string' ? path.basename(p.replace(/\\/g, '/')) : '';
const truncCmd = (cmd: string) => cmd?.length > 48 ? cmd.slice(0, 48) + '…' : cmd;

const DiffStats = ({ added, removed }: any) => added == null && removed == null ? null : (
  <span className="flex items-center gap-0.5 shrink-0 font-mono text-[11px] ml-1.5 opacity-70">
    {added != null && <span className="text-diff-add">+{added}</span>}
    {removed != null && <span className="text-diff-del">-{removed}</span>}
  </span>
);

export default function ToolCallRow({ tc, convId }: { tc: UIToolPart; convId: string }) {
  const { openFileViewer, openFileDiff, openWorkspaceFile } = useUIStore();
  let args: any = {}; try { args = JSON.parse(tc.args); } catch {}
  const meta = tc.meta || {}, done = tc.status === 'done', errored = tc.status === 'error';
  const isClickable = done && ['read_file', 'write_file', 'edit_file'].includes(tc.name);

  const handleClick = () => {
    if (!isClickable) return;
    const p = meta.path || args.path;
    if (tc.name === 'edit_file') {
      const o = (meta.original as string) ?? '', m = (meta.modified as string) ?? '';
      if (!o && !m) return;
      openFileDiff(convId, p, o, m);
    } else if (tc.name === 'write_file') {
      const o = (meta.original as string) ?? '', m = (meta.modified as string) ?? '';
      if (meta.isNew || (!o && !m)) openWorkspaceFile(convId, p); else openFileDiff(convId, p, o, m);
    } else { openWorkspaceFile(convId, p); }
  };

  const filePath = meta.path || args.path;
  /* verb — very muted label */
  const verb = (v: string) => <span className={`${errored ? 'text-destructive/50' : 'text-foreground/30'} text-xs shrink-0 font-normal`}>{v}</span>;
  /* mono — prominent filename */
  const mono = (t: string) => <span className={`${errored ? 'text-destructive/80' : 'text-foreground/70'} font-medium text-xs truncate`}>{t}</span>;
  const lineRange = (meta.startLine || meta.endLine) ? <span className="text-foreground/25 text-[11px] shrink-0 font-mono ml-1">#L{meta.startLine}-{meta.endLine}</span> : null;
  const iconCls = `size-3 shrink-0 ${errored ? 'text-destructive/50' : 'text-foreground/30'}`;

  let content: React.ReactNode;
  switch (tc.name) {
    case 'read_file':   content = <>{verb('Read')} <FileIcon fileName={basename(filePath)} className="size-3 shrink-0 text-foreground/30" /> {mono(basename(filePath))}{lineRange}</>; break;
    case 'write_file':  content = <>{verb('Created')} <FileIcon fileName={basename(filePath)} className="size-3 shrink-0 text-foreground/30" /> {mono(basename(filePath))}<DiffStats added={meta.diffAdded} removed={meta.isNew ? undefined : meta.diffRemoved} /></>; break;
    case 'edit_file':   content = <>{verb('Edited')} <FileIcon fileName={basename(filePath)} className="size-3 shrink-0 text-foreground/30" /> {mono(basename(filePath))}<DiffStats added={meta.diffAdded} removed={meta.diffRemoved} /></>; break;
    case 'list_dir': {
      const count = meta.count ?? 0;
      content = <>{verb('Explored')} {mono(count > 0 ? `${count} file${count === 1 ? '' : 's'}` : basename(filePath))}</>;
      break;
    }
    case 'run_command':      content = <>{verb('Ran')} <VscTerminal className={iconCls} /> {mono(truncCmd(args.command))}</>; break;
    case 'search_web':       content = <>{verb('Searched')} <VscGlobe className={iconCls} /> {mono((args.query || '').slice(0, 48))}</>; break;
    case 'search_workspace': content = <>{verb('Grep')} <VscSearch className={iconCls} /> {mono(args.query)}{args.include ? <span className="text-foreground/25 text-[11px] shrink-0 font-mono ml-1">{args.include}</span> : null}</>; break;
    case 'generate_image':   content = <>{verb('Generated')} <VscSymbolColor className={iconCls} /> {mono((args.prompt || '').slice(0, 44))}</>; break;
    case 'read_skill':       content = <>{verb('Skill')} <VscBook className={iconCls} /> {mono(args.name)}</>; break;
    default: content = <>{verb(tc.name)}</>;
  }

  return (
    <Button type="button" variant="ghost" onClick={handleClick}
      className={`group rounded-full -ml-2 px-2 py-0 h-5 bg-transparent border-none shadow-none text-xs font-normal justify-start gap-1 w-fit select-none ${isClickable ? 'cursor-pointer hover:bg-white/5' : 'cursor-default hover:bg-transparent'} ${errored ? 'text-destructive' : ''}`}>
      <span className={`flex items-center gap-1 flex-1 min-w-0 overflow-hidden ${done || errored ? '' : 'opacity-60'}`}>{content}</span>
      {!done && !errored && <Spinner className="ml-1 size-3 shrink-0" />}
    </Button>
  );
}
