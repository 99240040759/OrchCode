import * as React from 'react';
import * as Icons from '@react-symbols/icons';
import { getIconForFile, getIconForFolder } from '@react-symbols/icons/utils';
export type IconName = keyof typeof Icons;
export function getIconByName(name: IconName): React.ComponentType<any> | undefined { return Icons[name]; }
export function FileIcon({ fileName, className }: { fileName: string; className?: string }) {
  return getIconForFile({ fileName, autoAssign: true, className });
}
export function FolderIcon({ folderName, className }: { folderName: string; className?: string }) {
  return getIconForFolder({ folderName, className });
}
