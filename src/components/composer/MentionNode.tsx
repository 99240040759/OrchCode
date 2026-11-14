import type { KeyboardEvent, MouseEvent } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as ProseNode } from "@tiptap/pm/model";
import Mention from "@tiptap/extension-mention";
import { getBasename } from "../../lib/utils";
import { FileIcon } from "../common/FileIcon";
import { openArtifact } from "../panel/actions";

function MentionView({ node }: ReactNodeViewProps) {
  const path = (node.attrs.id as string) || "";
  const name = (node.attrs.label as string) || getBasename(path) || path;
  const open = () => path && openArtifact(path);

  return (
    <NodeViewWrapper
      as="span"
      className="chip"
      title={path}
      role="button"
      tabIndex={0}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        open();
      }}
    >
      <FileIcon name={name} />
      <span className="chip-name">{name}</span>
    </NodeViewWrapper>
  );
}

export const FileMention = Mention.extend({
  name: "mention",
  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },
});

export function extractPromptFromDoc(doc: ProseNode): string {
  let text = "";
  doc.descendants((node) => {
    if (node.type.name === "mention") {
      text += `@[${node.attrs.id || ""}] `;
      return false;
    }
    if (node.isText) text += node.text;
    else if (node.type.name === "hardBreak") text += "\n";
    else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n";
  });
  return text;
}
