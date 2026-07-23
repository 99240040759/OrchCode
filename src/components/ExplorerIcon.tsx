import React, { SVGProps } from "react";
import { FileIcon, FolderIcon, DefaultFolderOpenedIcon } from "@react-symbols/icons/utils";

export type ExplorerIconType = "file" | "folder" | "folder-open";

export interface ExplorerIconProps extends SVGProps<SVGSVGElement> {
  type: ExplorerIconType;
  name: string;
}

export const ExplorerIcon: React.FC<ExplorerIconProps> = ({ type, name, ...svgProps }) => {
  if (type === "folder-open") return <DefaultFolderOpenedIcon {...svgProps} />;
  if (type === "folder") return <FolderIcon folderName={name} {...svgProps} />;
  return <FileIcon fileName={name} autoAssign={true} {...svgProps} />;
};

export default ExplorerIcon;
