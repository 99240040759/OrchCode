import { Fragment } from "react";
import { LuChevronRight } from "react-icons/lu";
import { splitPathParts } from "../../lib/utils";
import { useWorkspaceStore } from "../../lib/workspace";
import { FileIcon } from "../common/FileIcon";

export function Crumbs({ path }: { path: string }) {
  const project = useWorkspaceStore((s) => s.current?.name);
  const parts = splitPathParts(path);
  const trail = project ? [project, ...parts] : parts;

  return (
    <div className="crumbs" title={path}>
      {trail.map((part, i) => {
        const last = i === trail.length - 1;
        return (
          <Fragment key={`${part}-${i}`}>
            {i > 0 && <LuChevronRight />}
            <span>
              {last && <FileIcon name={part} />}
              {part}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
