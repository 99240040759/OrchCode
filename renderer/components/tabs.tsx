import React, { useRef, useState, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'
import { TbX, TbPhoto } from 'react-icons/tb'
import { FileIcon } from './FileIcon'
export interface FileTabProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  name: string; path?: string; iconType?: 'file' | 'image' | 'browser'; browserIcon?: React.ReactNode; active?: boolean; onClick?: () => void; onClose?: () => void; className?: string; maxWidth?: string
}
export const FileTab = React.forwardRef<HTMLDivElement, FileTabProps>(({ name, path, iconType = 'file', browserIcon, active = true, onClick, onClose, className, maxWidth = 'max-w-[200px]', ...props }, ref) => (
  <div ref={ref} {...props} className={cn('group relative inline-flex items-center rounded-lg border transition-all flex-shrink-0 text-sm font-medium overflow-hidden', active ? 'bg-card text-foreground shadow-sm border-border' : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground border-transparent', className)}>
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-2 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-transparent border-none text-current font-medium text-left truncate min-w-0', onClick ? 'cursor-pointer' : 'cursor-default')}>
      <div className="relative w-[16px] h-[16px] flex items-center justify-center flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
        <div className={cn('absolute inset-0 flex items-center justify-center transition-opacity', onClose ? 'opacity-100 group-hover:opacity-0' : 'opacity-100')}>
          {iconType === 'browser' ? browserIcon : iconType === 'image' ? <TbPhoto size={16} /> : <FileIcon path={path || name} size={16} />}
        </div>
      </div>
      <span className={cn('truncate', maxWidth)}>{name}</span>
    </button>
    {onClose && (
      <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} className="absolute left-3 top-[50%] -translate-y-[50%] w-[16px] h-[16px] flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground bg-background/80 border-none rounded-[4px] opacity-0 group-hover:opacity-100 transition-opacity z-10 outline-none" aria-label={`Close ${name}`}>
        <TbX size={12} strokeWidth={2.5} />
      </button>
    )}
  </div>
))
FileTab.displayName = 'FileTab'
export interface ScrollableTabBarProps { children: React.ReactNode; leftNode?: React.ReactNode; rightNode?: React.ReactNode; className?: string; gap?: string }
export function ScrollableTabBar({ children, leftNode, rightNode, className, gap = 'gap-1.5' }: ScrollableTabBarProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth)
    }
  }, [])
  useEffect(() => {
    checkScroll()
    window.addEventListener('resize', checkScroll)
    const observer = new MutationObserver(checkScroll)
    if (scrollRef.current) observer.observe(scrollRef.current, { childList: true, subtree: true, characterData: true })
    return () => {
      window.removeEventListener('resize', checkScroll)
      observer.disconnect()
    }
  }, [checkScroll])
  return (
    <div className={cn('flex items-center px-2 border-b border-border flex-shrink-0 bg-background w-full overflow-hidden h-topbar', className)}>
      {leftNode && (
        <div className="flex items-center flex-shrink-0 relative z-10 bg-background pr-1.5">
          <div className={cn('absolute left-full top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent pointer-events-none transition-opacity duration-200', canScrollLeft ? 'opacity-100' : 'opacity-0')} />
          {leftNode}
        </div>
      )}
      <div ref={scrollRef} onScroll={checkScroll} className={cn('flex items-center h-full min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar flex-1 z-0', gap)}>{children}</div>
      {rightNode && (
        <div className="flex items-center flex-shrink-0 pl-3 relative z-10 bg-background h-full">
          <div className={cn('absolute right-full top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent pointer-events-none transition-opacity duration-200', canScrollRight ? 'opacity-100' : 'opacity-0')} />
          {rightNode}
        </div>
      )}
    </div>
  )
}
