import { Fragment } from 'react';
import { FileIcon } from '@/components/ui/FileIcon';
import { FluentFolder } from '@react-symbols/icons';
import { useWorkspacesStore } from '@/store/workspaces';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb';
export function FileBreadcrumb({ filePath }: { filePath: string }) {
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const activeWs = workspaces.find(w => filePath.startsWith(w.path));
  const displayPath = activeWs ? filePath.slice(activeWs.path.length).replace(/^\//, '') : filePath;
  const parts = displayPath.split('/').filter(Boolean);
  return (
    <Breadcrumb className="truncate select-none font-mono text-xs">
      <BreadcrumbList className="flex-nowrap gap-1">
        {parts.map((p, idx) => {
          const isLast = idx === parts.length - 1;
          return (
            <Fragment key={idx}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="flex items-center gap-1 font-medium">
                    <FileIcon fileName={p} className="size-3.5 shrink-0" />
                    {p}
                  </BreadcrumbPage>
                ) : (
                  <div className="flex items-center gap-1 text-muted-foreground/80">
                    <FluentFolder className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span>{p}</span>
                  </div>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
