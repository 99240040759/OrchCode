import React from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import Skeleton from 'react-loading-skeleton'
import { Info, Package, FileCode } from 'lucide-react'
import { FileIcon } from './ToolCallBlock'
import { getDisplayName, getArtifactIcon } from '../lib/uiUtils'
import type { ArtifactEntry } from '../../../preload/index.d'
import type { FileChangeEntry } from '../store/agentStore'
import { Panel } from './Primitives'
import * as styles from './editor.css'

interface OverviewPanelProps {
  artifacts: ArtifactEntry[]
  userFiles: FileChangeEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
  handleFileChangeClick: (fc: FileChangeEntry) => void
}

const OverviewPanel: React.FC<OverviewPanelProps> = ({
  artifacts,
  userFiles,
  loading,
  handleArtifactClick,
  handleFileChangeClick
}) => {
  return (
    <ScrollArea.Root className="ScrollAreaRoot">
      <ScrollArea.Viewport className="ScrollAreaViewport">
        <div className={styles.overviewContainer}>
          <div className={styles.overviewHeader}>
            <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            <h2 className={styles.overviewTitle}>Session Overview</h2>
          </div>

          <div className={styles.overviewGrid}>
            <Panel className={styles.overviewPanel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderLeft}>
                  <Package size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Artifacts</span>
                </div>
              </div>
              <div className={styles.panelContent}>
                {loading ? (
                  <Skeleton
                    count={3}
                    height={28}
                    baseColor="#262626"
                    highlightColor="#333333"
                    style={{ marginBottom: 6, borderRadius: 4 }}
                  />
                ) : artifacts.length === 0 ? (
                  <div className={styles.emptyText}>No artifacts created yet.</div>
                ) : (
                  artifacts.map((art) => (
                    <div
                      key={art.name}
                      onClick={() => handleArtifactClick(art)}
                      className={styles.overviewItem}
                    >
                      {getArtifactIcon(art.name, 15)}
                      <span className={styles.itemText}>{getDisplayName(art.name)}</span>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel className={styles.overviewPanel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderLeft}>
                  <FileCode size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Files Changed</span>
                </div>
              </div>
              <div className={styles.panelContent}>
                {userFiles.length === 0 ? (
                  <div className={styles.emptyText}>No workspace files modified.</div>
                ) : (
                  userFiles.map((fc) => (
                    <div
                      key={fc.path}
                      onClick={() => handleFileChangeClick(fc)}
                      className={styles.overviewItem}
                    >
                      <FileIcon fileName={fc.name} size={13} />
                      <span className={styles.itemText}>{fc.name}</span>
                      {fc.lineRange && <span className={styles.itemLineRange}>{fc.lineRange}</span>}
                      <div className={styles.diffStats}>
                        {fc.additions > 0 && (
                          <span className={styles.diffAdd}>+{fc.additions}</span>
                        )}
                        {fc.deletions > 0 && (
                          <span className={styles.diffSub}>-{fc.deletions}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
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
