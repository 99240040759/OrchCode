import { useUIStore } from '@/store/ui';
import path from 'path-browserify';
import { VscGlobe, VscTerminal, VscSearch, VscSymbolColor, VscBook } from 'react-icons/vsc';
import { FileIcon } from '@/components/ui/FileIcon';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import type { UIToolPart } from '@/ipc/types';

const basename = (p: any) => typeof p === 'string' ? path.basename(p.replace(/\\/g, '/')) : '', dirbasename = basename, truncCmd = (cmd: string) => cmd?.length > 44 ? cmd.slice(0, 44) + '…' : cmd;
const DiffStats = ({ added, removed }: any) => added == null && removed == null ? null : <span className="flex items-center gap-1 shrink-0 font-mono text-[11px] ml-1.5">{added != null && <span className="text-[#4ade80]">+{added}</span>}{removed != null && <span className="text-[#f87171]">-{removed}</span>}</span>;

export default function ToolCallRow({ tc, convId }: { tc: UIToolPart; convId: string }) {
  const { openFileViewer, openFileDiff, openWorkspaceFile } = useUIStore();
  let args: any = {}; try { args = JSON.parse(tc.args); } catch {}
  const meta = tc.meta || {}, done = tc.status === 'done', errored = tc.status === 'error', isClickable = done && ['read_file', 'write_file', 'edit_file'].includes(tc.name);

  const handleClick = () => {
    if (!isClickable) return;
    const p = meta.path || args.path;
    if (tc.name === 'edit_file') {
      if (!tc.result) return;
      let o = '', m = ''; try { const j = JSON.parse(tc.result); o = j.original; m = j.modified; } catch { m = tc.result; } openFileDiff(convId, p, o, m);
    } else {
      openWorkspaceFile(convId, p);
    }
  };

  const filePath = meta.path || args.path;
  const verb = (v: string) => <span className={errored ? "text-destructive/80 text-sm shrink-0 font-normal" : "text-muted-foreground/80 text-sm shrink-0 font-normal"}>{v}</span>;
  const mono = (t: string) => <span className={errored ? "text-destructive font-semibold text-sm truncate" : "text-foreground font-semibold text-sm truncate"}>{t}</span>;
  const lineRange = (meta.startLine || meta.endLine) ? <span className="text-muted-foreground/60 text-[11px] shrink-0 font-mono ml-1.5">#L{meta.startLine}–L{meta.endLine}</span> : null;
  const iconColor = errored ? 'text-destructive/80' : 'text-muted-foreground/80';

  let content: React.ReactNode;
  switch (tc.name) {
    case 'read_file': content = <>{verb('Read')} <FileIcon fileName={basename(filePath)} className="size-3.5 shrink-0" /> {mono(basename(filePath))}{lineRange}</>; break;
    case 'write_file': content = <>{verb('Created')} <FileIcon fileName={basename(filePath)} className="size-3.5 shrink-0" /> {mono(basename(filePath))}<DiffStats added={meta.diffAdded} /></>; break;
    case 'edit_file': content = <>{verb('Edited')} <FileIcon fileName={basename(filePath)} className="size-3.5 shrink-0" /> {mono(basename(filePath))}<DiffStats added={meta.diffAdded} removed={meta.diffRemoved} /></>; break;
    case 'list_dir': {
      const count = meta.count ?? 0;
      const desc = count > 0 ? `${count} ${count === 1 ? 'file' : 'files'}` : dirbasename(filePath);
      content = <>{verb('Explored')} {mono(desc)} {count > 0 && <span className="text-muted-foreground/60 text-xs font-mono ml-0.5">&gt;</span>}</>;
      break;
    }
    case 'run_command': content = <>{verb('Ran')} <VscTerminal className={`size-3.5 shrink-0 ${iconColor}`} /> {mono(truncCmd(args.command))}</>; break;
    case 'search_web': content = <>{verb('Searched')} <VscGlobe className={`size-3.5 shrink-0 ${iconColor}`} /> {mono((args.query || '').slice(0, 44))}</>; break;
    case 'search_workspace': content = <>{verb('Grep')} <VscSearch className={`size-3.5 shrink-0 ${iconColor}`} /> {mono(args.query)}{args.include ? <span className="text-muted-foreground/60 text-xs shrink-0 font-mono ml-1.5"> {args.include}</span> : null}</>; break;
    case 'generate_image': content = <>{verb('Generated')} <VscSymbolColor className={`size-3.5 shrink-0 ${iconColor}`} /> {mono((args.prompt || '').slice(0, 40))}</>; break;
    case 'read_skill': content = <>{verb('Skill')} <VscBook className={`size-3.5 shrink-0 ${iconColor}`} /> {mono(args.name)}</>; break;
    default: content = <>{verb(tc.name)}</>;
  }

  return (
    <Button type="button" variant="ghost" onClick={handleClick} className={`group rounded-full -ml-2.5 px-2.5 has-[>svg]:px-2.5 py-0.5 h-6 bg-transparent border-none shadow-none transition-all text-sm font-normal justify-start gap-1.5 w-fit select-none ${isClickable ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'} ${errored ? 'text-destructive' : ''}`}>
      <span className={`flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden ${done || errored ? '' : 'opacity-70'}`}>{content}</span>
      {!done && !errored && <Spinner className="ml-auto size-3.5 shrink-0" />}
    </Button>
  );
}
