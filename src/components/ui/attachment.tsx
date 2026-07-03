import { FileIcon } from '@/components/ui/FileIcon';
import { Button } from '@/components/ui/button';
import { VscChromeClose } from 'react-icons/vsc';
import { cn } from '@/lib/utils';


export const IMAGE_ACCEPT = 'image/*';
export const FILE_ACCEPT = '.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.ini,.toml';

export function FilePill({ name, onRemove, onClick, className }: { name: string; onRemove?: () => void; onClick?: () => void; className?: string }) {
  return (
    <div onClick={onClick} className={cn('inline-flex w-fit max-w-44 items-center gap-1 rounded-md border border-border/50 bg-white/5 px-2 py-0.5 text-xs', onClick && 'cursor-pointer transition-colors duration-100 hover:bg-white/8', className)}>
      <FileIcon fileName={name} className="size-3 shrink-0" />
      <span className="truncate text-foreground/70">{name}</span>
      {onRemove && <Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-1 text-foreground/30 hover:bg-transparent hover:text-foreground/70"><VscChromeClose className="size-2.5" /></Button>}
    </div>
  );
}

export function ImageThumb({ name, dataUrl, onRemove, onClick, className }: { name: string; dataUrl?: string; onRemove?: () => void; onClick?: () => void; className?: string }) {
  if (!dataUrl) return null;
  return (
    <div className="group relative inline-flex shrink-0">
      <img src={dataUrl} alt={name} onClick={onClick} className={cn('rounded-md border border-border object-cover', onClick && 'cursor-pointer', className)} />
      {onRemove && <Button type="button" variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute -right-1.5 -top-1.5 size-4 rounded-full border border-border/60 bg-background text-foreground/50 opacity-0 transition-opacity duration-100 hover:text-foreground group-hover:opacity-100"><VscChromeClose className="size-2.5" /></Button>}
    </div>
  );
}
