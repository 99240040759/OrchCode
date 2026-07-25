import React, { SVGProps } from "react";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";

export type ExplorerIconType = "file" | "folder";

export interface ExplorerIconProps extends SVGProps<SVGSVGElement> {
  type: ExplorerIconType;
  name: string;
}

export const ExplorerIcon: React.FC<ExplorerIconProps> = ({ type, name, ...svgProps }) => {
  if (type === "folder") return <FolderIcon folderName={name} {...svgProps} />;
  return <FileIcon fileName={name} autoAssign {...svgProps} />;
};

export default ExplorerIcon;
