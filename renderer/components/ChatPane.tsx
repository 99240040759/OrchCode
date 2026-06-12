import React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ChevronDown, Code, Loader, FolderOpen, Plus } from 'lucide-react'
import Lottie from 'lottie-react'
import emptyStateAnimation from '../assets/empty-state.json'
import InputBar from './InputBar'
import ChatThread from './ChatThread'
import { isThreadLoadingAtom, isArtifactPanelOpenAtom, hasMessagesAtom, activeWorkspaceAtom,  threadListAtom } from '../store/agentStore'
import { useChat } from '../hooks/useChat'
import Dropdown, { DropdownItem, DropdownSeparator } from './Dropdown'
import Tooltip from './Tooltip'

export const ChatPane: React.FC = () => {
    const isLoading = useAtomValue(isThreadLoadingAtom)
    const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
    const hasMessages = useAtomValue(hasMessagesAtom)
    const activeWorkspace = useAtomValue(activeWorkspaceAtom)
    const threads = useAtomValue(threadListAtom)
    const { run, stop, openWorkspace, selectThread, newConversation, loadThreads } = useChat()
    const workspaces = React.useMemo(() => {
      const seen = new Set<string>(), list: { name: string; path: string }[] = []
      threads.forEach(t => { if (t.workspacePath && !seen.has(t.workspacePath)) { seen.add(t.workspacePath); list.push({ name: t.workspacePath.split(/[/\\]/).pop() ?? 'Workspace', path: t.workspacePath }) } })
      return list
    }, [threads])
    const handleWorkspaceSelect = async (path: string) => {
      const wThreads = threads.filter(t => t.workspacePath === path)
      if (wThreads.length > 0) {
        wThreads.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
        await selectThread(wThreads[0].id)
      } else {
        const newId = await newConversation()
        await window.api.invoke('workspace:set-active', { conversationId: newId, workspacePath: path })
        await loadThreads()
        await selectThread(newId)
      }
    }
    const fullWidth = !isArtifactPanelOpen
    const onSubmit = (p: string, a?: any[]) => run(p, a)
    const onStop = () => stop()
    const onOpenArtifacts = () => setArtifactPanelOpen(true)
    const onOpenWorkspace = () => openWorkspace()
    return (
      <div className="chat-pane-root">
        {isLoading && (
          <div className="thread-loading-overlay">
            <Loader className="animate-spin" size={24} />
          </div>
        )}
        <div className={`chat-pane-content${fullWidth ? ' chat-pane-content-full-width' : ''} ${hasMessages ? 'chat-state' : 'home-state'}`}>
          <div className="home-hero-section">
            <div className="home-lottie-container">
              <Lottie
                animationData={emptyStateAnimation}
                loop={true}
                className="home-lottie"
              />
            </div>
          </div>
          <div className="home-title-section">
            <div className="home-prompt-header-wrapper">
              <Dropdown align="center" side="bottom" sideOffset={6} className="dropdown-menu-content-sm" trigger={
                <Tooltip content="Choose or open project workspace"><button type="button" className="project-pill-select"><span>{activeWorkspace ? activeWorkspace.name : 'Select Project'}</span><ChevronDown size={14} className="pill-chevron" /></button></Tooltip>
              }>
                {workspaces.map(w => (
                  <DropdownItem key={w.path} onSelect={() => handleWorkspaceSelect(w.path)} className={`app-dropdown-item${activeWorkspace?.path === w.path ? ' selected' : ''}`}><FolderOpen size={14} /><span>{w.name}</span></DropdownItem>
                ))}
                {workspaces.length > 0 && <DropdownSeparator className="profile-separator" />}
                <DropdownItem onSelect={onOpenWorkspace} className="app-dropdown-item"><Plus size={14} /><span>Open Project Folder...</span></DropdownItem>
              </Dropdown>
            </div>
          </div>
          <div className="chat-thread-wrapper">
            <ChatThread />
          </div>
          <div className="chat-pane-input">
            <InputBar onSubmit={onSubmit} onStop={onStop} />
          </div>
          <div className="home-footer-section">
            {fullWidth && (
              <div className="prompt-sub-links">
                <a href="#" className="prompt-sub-link" onClick={(e) => { e.preventDefault(); onOpenArtifacts() }}>
                  <Code size={14} strokeWidth={2} />
                  <span>Open editor</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    )
}
