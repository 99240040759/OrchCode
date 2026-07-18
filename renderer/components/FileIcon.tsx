import React from 'react'
import { FileIcon as SymbolsIcon, FolderIcon as SymbolsFolderIcon } from '@react-symbols/icons/utils'
import { TbPlug } from 'react-icons/tb'
import githubIcon from '../assets/github.svg'
import chromeIcon from '../assets/chrome.svg'
import { cn } from '../lib/utils'
interface FileIconProps { path: string; className?: string; size?: number; isFolder?: boolean }
export function FileIcon({ path, className, size = 14, isFolder }: FileIconProps): React.JSX.Element {
  const lower = path.toLowerCase()
  if (lower === 'github') return <img src={githubIcon} width={size} height={size} className={className} alt="GitHub" />
  if (lower === 'browser') return <img src={chromeIcon} width={size} height={size} className={className} alt="Browser" />
  if (lower === 'mcp') return <TbPlug size={size} className={className} />
  const name = path.split(/[\\/]/).pop() ?? ''
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      {isFolder ? <SymbolsFolderIcon folderName={name} width={size} height={size} /> : <SymbolsIcon fileName={name} autoAssign={true} width={size} height={size} />}
    </span>
  )
}
