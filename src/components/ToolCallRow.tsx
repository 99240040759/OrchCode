import { useUIStore } from '@/store/ui';
import { VscGlobe, VscTerminalCmd, VscSearch, VscSymbolColor, VscBook } from 'react-icons/vsc';
import { FileIcon, FolderIcon } from '@/components/ui/FileIcon';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import type { UIToolPart } from '@/ipc/types';
const basename = (p: string) => p?.split('/').pop() || p, dirbasename = (p: string) => (p?.replace(/\/$/, '')?.split('/').pop() || p), truncCmd = (cmd: string) => cmd?.length > 44 ? cmd.slice(0, 44) + '…' : cmd;
const DiffStats = ({ added, removed }: any) => added == null && removed == null ? null : <span className="flex items-center gap-0.5 shrink-0 font-mono text-xs">{added != null && <span className="text-green-500">+{added}</span>}{removed != null && <span className="text-destructive"> -{removed}</span>}</span>;
export default function ToolCallRow({ tc, convId }: { tc: UIToolPart; convId: string }) {
  const { openFileViewer, openFileDiff } = useUIStore();
  let args: any = {}; try { args = JSON.parse(tc.args); } catch {}
  const meta = tc.meta || {}, done = tc.status === 'done', errored = tc.status === 'error', isClickable = done && ['read_file', 'write_file', 'edit_file'].includes(tc.name);
  const handleClick = () => {
    if (!isClickable || !tc.result) return;
    const p = meta.path || args.path;
    if (tc.name === 'read_file') openFileViewer(convId, p, tc.result, meta.startLine || 1, meta.endLine || tc.result.split('\n').length);
    else { let o = '', m = ''; try { const j = JSON.parse(tc.result); o = j.original; m = j.modified; } catch { m = tc.result; } openFileDiff(convId, p, o, m); }
  };
  const verb = (v: string) => <span className="text-muted-foreground shrink-0">{v}</span>, mono = (t: string) => <span className="text-foreground font-medium font-mono truncate">{t}</span>, path = meta.path || args.path;
  const lineRange = (meta.startLine || meta.endLine) ? <span className="text-muted-foreground text-xs shrink-0 font-mono">#{meta.startLine}–{meta.endLine}</span> : null;
  let content: React.ReactNode;
  switch (tc.name) {
    case 'read_file': content = <>{verb('Read')} <FileIcon fileName={basename(path)} className="size-3.5 shrink-0" /> {mono(basename(path))} {lineRange}</>; break;
    case 'write_file': content = <>{verb('Created')} <FileIcon fileName={basename(path)} className="size-3.5 shrink-0" /> {mono(basename(path))} <DiffStats added={meta.diffAdded} /></>; break;
    case 'edit_file': content = <>{verb('Edited')} <FileIcon fileName={basename(path)} className="size-3.5 shrink-0" /> {mono(basename(path))} <DiffStats added={meta.diffAdded} removed={meta.diffRemoved} /></>; break;
    case 'list_dir': content = <>{verb('Explored')} <FolderIcon folderName={dirbasename(path)} className="size-3.5 shrink-0" /> {mono(dirbasename(path))}</>; break;
    case 'run_command': content = <>{verb('Ran')} <VscTerminalCmd className="size-3.5 shrink-0" /> {mono(truncCmd(args.command))}</>; break;
    case 'search_web': content = <>{verb('Searched')} <VscGlobe className="size-3.5 shrink-0" /> {mono((args.query || '').slice(0, 44))}</>; break;
    case 'search_workspace': content = <>{verb('Grep')} <VscSearch className="size-3.5 shrink-0" /> {mono(args.query)}{args.include ? <span className="text-muted-foreground text-xs shrink-0"> {args.include}</span> : null}</>; break;
    case 'generate_image': content = <>{verb('Generated')} <VscSymbolColor className="size-3.5 shrink-0" /> {mono((args.prompt || '').slice(0, 40))}</>; break;
    case 'read_skill': content = <>{verb('Skill')} <VscBook className="size-3.5 shrink-0" /> {mono(args.name)}</>; break;
    default: content = <>{verb(tc.name)}</>;
  }
  return (
    <Button type="button" variant="ghost" onClick={handleClick} disabled={!isClickable} className={`my-[-1px] w-fit ${isClickable ? 'cursor-pointer' : 'cursor-default'} ${errored ? 'text-destructive' : ''} disabled:opacity-100`}>
      <span className={`flex items-center gap-1 flex-1 min-w-0 overflow-hidden ${done || errored ? '' : 'opacity-70'}`}>{content}</span>
      {!done && !errored && <Spinner className="ml-auto size-3.5 shrink-0" />}
    </Button>
  );
}
