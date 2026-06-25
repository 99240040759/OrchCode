import { useModelsStore } from '@/store/models';
import { VscChevronDown } from 'react-icons/vsc';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function ModelDropdown() {
  const { models, selectedKey, setSelectedKey } = useModelsStore();
  const model = models[selectedKey] ?? null;
  if (!Object.keys(models).length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="model-dropdown-trigger" variant="ghost" size="xs" className="text-foreground/35 hover:text-foreground/60 font-normal gap-1 font-mono">
          <span className="max-w-28 truncate">{model?.name || 'Select model'}</span>
          <VscChevronDown className="size-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel className="label-xs px-2 py-1.5">Models</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {Object.entries(models).map(([key, m]) => (
          <DropdownMenuItem key={key} id={`model-${key}`} onSelect={() => setSelectedKey(key)} className={cn('gap-2 text-xs', key === selectedKey && 'bg-white/6')}>
            <span className="flex-1 font-mono">{m.name}</span>
            {m.multimodal && <span className="text-[11px] text-foreground/40">📎</span>}
            {m.badge && <Badge variant="outline" className="text-[11px] px-1 py-0 h-3.5 border-border/60">{m.badge}</Badge>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
