import { Fragment } from 'react';
import { FileIcon } from '@/components/ui/FileIcon';
import { FluentFolder } from '@react-symbols/icons';
import { useWorkspacesStore } from '@/store/workspaces';
export function FileBreadcrumb({ filePath }: { filePath: string }) {
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const activeWs = workspaces.find(w => filePath.startsWith(w.path));
  const displayPath = activeWs ? filePath.slice(activeWs.path.length).replace(/^\//, '') : filePath;
  const parts = displayPath.split('/').filter(Boolean);
  return (
    <div className="flex items-center text-sm font-mono text-muted-foreground truncate select-none">
      {parts.map((p, idx) => {
        const isLast = idx === parts.length - 1;
        return (
          <Fragment key={idx}>
            {idx > 0 && <span className="text-muted-foreground/40 px-1.5">›</span>}
            <span className="flex items-center gap-1.5">
              {isLast ? <FileIcon fileName={p} className="size-[18px] shrink-0" /> : <FluentFolder className="size-[18px] shrink-0 text-muted-foreground/70" />}
              <span className={isLast ? "text-foreground font-medium" : ""}>{p}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
