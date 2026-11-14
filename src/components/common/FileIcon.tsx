import { memo } from "react";
import {
  BsFileEarmarkExcelFill,
  BsFileEarmarkPdfFill,
  BsFileEarmarkPptFill,
  BsFileEarmarkWordFill,
} from "react-icons/bs";
import { FileIcon as SymbolFileIcon, FolderIcon } from "@react-symbols/icons/utils";
import { getExt } from "../../lib/utils";

const DOC_ICONS = {
  pdf: { Icon: BsFileEarmarkPdfFill, color: "#e2574c" },
  doc: { Icon: BsFileEarmarkWordFill, color: "#2f6fd1" },
  docx: { Icon: BsFileEarmarkWordFill, color: "#2f6fd1" },
  xls: { Icon: BsFileEarmarkExcelFill, color: "#1d8a4f" },
  xlsx: { Icon: BsFileEarmarkExcelFill, color: "#1d8a4f" },
  ods: { Icon: BsFileEarmarkExcelFill, color: "#1d8a4f" },
  ppt: { Icon: BsFileEarmarkPptFill, color: "#d0532f" },
  pptx: { Icon: BsFileEarmarkPptFill, color: "#d0532f" },
} as const;

export const FileIcon = memo(function FileIcon({ name, folder = false }: { name: string; folder?: boolean }) {
  if (folder) return <FolderIcon folderName={name} className="file-icon" aria-hidden="true" />;
  const doc = DOC_ICONS[getExt(name) as keyof typeof DOC_ICONS];
  if (doc) return <doc.Icon className="file-icon" style={{ color: doc.color }} aria-hidden="true" />;
  return <SymbolFileIcon fileName={name} autoAssign className="file-icon" aria-hidden="true" />;
});

export function ChromeIcon() {
  return <img src="/chrome.svg" alt="" className="file-icon" />;
}
