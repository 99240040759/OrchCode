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
  const allModels = Object.entries(models);
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id="model-dropdown-trigger" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground font-mono">
            <span className="max-w-24 truncate">{model?.name || 'Select model'}</span>
            {model?.badge && <Badge variant="secondary" className="text-xs px-1 py-0 h-4">{model.badge}</Badge>}
            <VscChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">Models</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allModels.map(([key, m]) => (
            <DropdownMenuItem key={key} id={`model-${key}`} onSelect={() => setSelectedKey(key)}
              className={cn('gap-2 text-xs', key === selectedKey && 'bg-accent')}>
              <span className="flex-1">{m.name}</span>
              {m.multimodal && <span className="text-xs text-muted-foreground">📎</span>}
              {m.badge && <Badge variant="outline" className="text-xs px-1 py-0 h-4">{m.badge}</Badge>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
