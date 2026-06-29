import { Fragment } from 'react';
import { FileIcon } from '@/components/ui/FileIcon';
import { FluentFolder } from '@react-symbols/icons';
import { useWorkspacesStore } from '@/store/workspaces';
import { useConversationsStore } from '@/store/conversations';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb';

export function FileBreadcrumb({ filePath }: { filePath: string }) {
  const workspaces = useWorkspacesStore(s => s.workspaces);
  const activeConvId = useConversationsStore(s => s.activeConvId);
  const conv = useConversationsStore(s => activeConvId ? s.convs[activeConvId] : null);
  const wsId = conv?.workspaceId;

  const normFile = filePath.replace(/\\/g, '/');
  const isAbs = normFile.startsWith('/') || /^[a-zA-Z]:/.test(normFile);

  // Agent session artifacts live outside any workspace — show just the filename, no folder trail.
  if (activeConvId && normFile.includes(`/sessions/${activeConvId}/`)) {
    const name = normFile.split('/').pop() || normFile;
    return (
      <Breadcrumb className="select-none font-mono text-xs">
        <BreadcrumbList className="flex-wrap gap-1">
          <BreadcrumbItem>
            <BreadcrumbPage className="flex items-center gap-1 font-medium">
              <FileIcon fileName={name} className="size-3.5 shrink-0" />{name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const activeWs = workspaces.find(w => {
    if (!isAbs) return wsId ? w.id === wsId : true;
    const normWs = w.path.replace(/\\/g, '/');
    return normFile.toLowerCase().startsWith(normWs.toLowerCase());
  });

  let displayPath = normFile;
  if (activeWs && isAbs) {
    const normWs = activeWs.path.replace(/\\/g, '/');
    displayPath = normFile.slice(normWs.length).replace(/^\/+/, '');
  }

  const parts = displayPath.split('/').filter(Boolean);
  if (activeWs) parts.unshift(activeWs.name);

  return (
    <Breadcrumb className="select-none font-mono text-xs">
      <BreadcrumbList className="flex-wrap gap-1">
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
