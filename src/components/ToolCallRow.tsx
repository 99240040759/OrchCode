import { useUIStore } from '@/store/ui';
import type React from "react";
import { VscGlobe, VscTerminalCmd, VscSearch, VscSymbolColor, VscBook } from 'react-icons/vsc';
import { FileIcon, FolderIcon } from '@/components/ui/FileIcon';
import { Spinner } from '@/components/ui/spinner';
import type { ToolPart } from '@/ipc/types';
const basename = (p: string) => p?.split('/').pop() || p;
const dirbasename = (p: string) => { const t = p?.replace(/\/$/, ''); return t?.split('/').pop() || t; };
const truncCmd = (cmd: string) => cmd?.length > 44 ? cmd.slice(0, 44) + '…' : cmd;
function DiffStats({ added, removed }: { added?: number; removed?: number }) {
  if (added == null && removed == null) return null;
  return (
    <span className="flex items-center gap-0.5 shrink-0 font-mono text-xs">
      {added != null && <span className="text-green-400">+{added}</span>}
      {removed != null && <span className="text-red-400"> -{removed}</span>}
    </span>
  );
}
export default function ToolCallRow({ tc, convId }: { tc: ToolPart; convId: string }) {
  const { openFileViewer, openFileDiff, openImageViewer } = useUIStore();
  let args: any = {};
  try { args = JSON.parse(tc.input); } catch {}
  const done = !!tc.output;
  const isClickable = done && ['read_file', 'write_file', 'edit_file', 'generate_image'].includes(tc.name);
  const handleClick = () => {
    if (!isClickable) return;
    if (tc.name === 'read_file') openFileViewer(convId, args.path, tc.output!, tc.startLine || 1, tc.endLine || tc.output!.split('\n').length);
    else if (tc.name === 'write_file' || tc.name === 'edit_file') {
      let orig = '', mod = '';
      try { const p = JSON.parse(tc.output!); orig = p.original; mod = p.modified; } catch { mod = tc.output!; }
      openFileDiff(convId, args.path, orig, mod);
    } else if (tc.name === 'generate_image') {
      try { const p = JSON.parse(tc.output!); if (p.dataUrl) openImageViewer(convId, p.prompt || 'Generated Image', p.dataUrl); } catch {}
    }
  };
  const verb = (v: string) => <span className="text-muted-foreground shrink-0">{v}</span>;
  const mono = (t: string) => <span className="text-foreground font-medium font-mono truncate">{t}</span>;
  const lineRange = (tc.startLine || tc.endLine)
    ? <span className="text-muted-foreground/55 text-xs shrink-0 font-mono">#{tc.startLine}–{tc.endLine}</span>
    : null;
  let content: React.ReactNode;
  switch (tc.name) {
    case 'read_file':
      content = <>{verb('Read')} <FileIcon fileName={basename(args.path)} className="size-3.5 shrink-0" /> {mono(basename(args.path))} {lineRange}</>;
      break;
    case 'write_file':
      content = <>{verb('Created')} <FileIcon fileName={basename(args.path)} className="size-3.5 shrink-0" /> {mono(basename(args.path))} <DiffStats added={tc.diffAdded} /></>;
      break;
    case 'edit_file':
      content = <>{verb('Edited')} <FileIcon fileName={basename(args.path)} className="size-3.5 shrink-0" /> {mono(basename(args.path))} <DiffStats added={tc.diffAdded} removed={tc.diffRemoved} /></>;
      break;
    case 'list_dir':
      content = <>{verb('Explored')} <FolderIcon folderName={dirbasename(args.path)} className="size-3.5 shrink-0" /> {mono(dirbasename(args.path))}</>;
      break;
    case 'run_command':
      content = <>{verb('Ran')} <VscTerminalCmd className="size-3.5 shrink-0 opacity-60" /> {mono(truncCmd(args.command))}</>;
      break;
    case 'search_web':
      content = <>{verb('Searched')} <VscGlobe className="size-3.5 shrink-0 opacity-60" /> {mono((args.query || '').slice(0, 44))}</>;
      break;
    case 'search_workspace':
      content = <>{verb('Grep')} <VscSearch className="size-3.5 shrink-0 opacity-60" /> {mono(args.query)}{args.include ? <span className="text-muted-foreground/55 text-mini shrink-0"> {args.include}</span> : null}</>;
      break;
    case 'generate_image':
      content = <>{verb('Generated')} <VscSymbolColor className="size-3.5 shrink-0 opacity-60" /> {mono((args.prompt || '').slice(0, 40))}</>;
      break;
    case 'read_skill':
      content = <>{verb('Skill')} <VscBook className="size-3.5 shrink-0 opacity-60" /> {mono(args.name)}</>;
      break;
    default:
      content = <>{verb(tc.name)}</>;
  }
  return (
    <button onClick={handleClick} disabled={!isClickable}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md my-0.5 w-fit text-left transition-colors min-w-0 ${isClickable ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default'}`}>
      <span className={`flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden ${done ? '' : 'opacity-70'}`}>{content}</span>
      {!done && <Spinner className="ml-auto size-3.5 shrink-0 opacity-50" />}
    </button>
  );
}
