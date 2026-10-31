import React from "react";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import * as utils from "../../lib/utils";
import { useArtifactsStore } from "../../lib/artifacts";
import { ExplorerIcon } from "../ChatPrimitives";

export function MentionNodeView(props: ReactNodeViewProps) {
  const path = (props.node.attrs.id as string) || "";
  const name =
    (props.node.attrs.label as string) || utils.getBasename(path) || path;
  const openFile = useArtifactsStore((s) => s.openFile);

  return (
    <NodeViewWrapper
      as="span"
      className="FileTag FileTag-clickable"
      data-path={path}
      title={path}
      role="button"
      tabIndex={0}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (path) openFile(path);
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (path) openFile(path);
        }
      }}
    >
      <ExplorerIcon
        type="file"
        name={name}
        className="FileTag-icon"
        width={13}
        height={13}
        aria-hidden="true"
      />
      <span className="FileTag-name">{name}</span>
    </NodeViewWrapper>
  );
}

export const FileMention = Mention.extend({
  name: "mention",
  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
});

export function extractPromptFromDoc(doc: any): string {
  let text = "";
  doc.descendants((node: any) => {
    if (node.type.name === "mention") {
      const path = node.attrs.id || "";
      text += `@[${path}] `;
      return false;
    }
    if (node.isText) {
      text += node.text;
    } else if (node.type.name === "hardBreak") {
      text += "\n";
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  });
  return text;
}
