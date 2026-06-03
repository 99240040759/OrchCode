import React from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import Skeleton from 'react-loading-skeleton'
import {
  Info,
  Package,
  FileCode,
  ClipboardList,
  BookOpen,
  FileText
} from 'lucide-react'
import { FileIcon } from './ToolCallBlock'
import { getDisplayName } from '../lib/uiUtils'
import type { ArtifactEntry } from '../../../preload/index.d'
import type { FileChangeEntry } from '../store/agentStore'

interface OverviewPanelProps {
  artifacts: ArtifactEntry[]
  userFiles: FileChangeEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
  handleFileChangeClick: (fc: FileChangeEntry) => void
}

const getArtifactIcon = (name: string) => {
  if (name === 'implementation_plan.md') {
    return <ClipboardList size={15} style={{ flexShrink: 0, color: 'var(--accent-purple)' }} />
  }
  if (name === 'walkthrough.md') {
    return <BookOpen size={15} style={{ flexShrink: 0, color: 'var(--accent-green)' }} />
  }
  return <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
}

export const getRelativeDirPath = (filePath: string, workspacePath?: string) => {
  let path = filePath
  if (workspacePath && path.startsWith(workspacePath)) {
    path = path.slice(workspacePath.length)
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    path = path.slice(1)
  }
  const parts = path.split(/[/\\]/)
  if (parts.length > 1) {
    return parts.slice(0, -1).join('/')
  }
  return ''
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  artifacts,
  userFiles,
  loading,
  handleArtifactClick,
  handleFileChangeClick
}) => {
  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px 32px',
            backgroundColor: 'var(--bg-app)',
            minHeight: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <h2
              style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
                fontFamily: 'var(--font-display)'
              }}
            >
              Session Overview
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '24px',
              alignItems: 'start'
            }}
          >
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                gap: '12px',
                minHeight: '260px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  paddingBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Package size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Artifacts</span>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  overflowY: 'auto'
                }}
              >
                {loading ? (
                  <Skeleton
                    count={3}
                    height={28}
                    baseColor="#262626"
                    highlightColor="#333333"
                    style={{ marginBottom: 6, borderRadius: 4 }}
                  />
                ) : artifacts.length === 0 ? (
                  <div
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                      padding: '8px 4px'
                    }}
                  >
                    No artifacts created yet.
                  </div>
                ) : (
                  artifacts.map((art) => (
                    <div
                      key={art.name}
                      onClick={() => handleArtifactClick(art)}
                      className="overview-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-primary)',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      {getArtifactIcon(art.name)}
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {getDisplayName(art.name)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div
              style={{
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                gap: '12px',
                minHeight: '260px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  paddingBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileCode size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Files Changed</span>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  overflowY: 'auto'
                }}
              >
                {userFiles.length === 0 ? (
                  <div
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                      padding: '8px 4px'
                    }}
                  >
                    No workspace files modified.
                  </div>
                ) : (
                  userFiles.map((fc) => (
                    <div
                      key={fc.path}
                      onClick={() => handleFileChangeClick(fc)}
                      className="overview-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-primary)',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      <FileIcon fileName={fc.name} size={13} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}
                      >
                        {fc.name}
                      </span>
                      {fc.lineRange && (
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--font-size-xs)',
                            flexShrink: 0,
                            marginRight: '4px'
                          }}
                        >
                          {fc.lineRange}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {fc.additions > 0 && (
                          <span
                            style={{
                              color: 'var(--accent-green)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 700
                            }}
                          >
                            +{fc.additions}
                          </span>
                        )}
                        {fc.deletions > 0 && (
                          <span
                            style={{
                              color: 'var(--accent-red)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 700
                            }}
                          >
                            -{fc.deletions}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="ScrollAreaScrollbar" orientation="vertical">
        <ScrollArea.Thumb className="ScrollAreaThumb" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner className="ScrollAreaCorner" />
    </ScrollArea.Root>
  )
}
export default OverviewPanel
