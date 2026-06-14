import React, { useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Check, X, Shield, ChevronDown, ChevronRight } from 'lucide-react'
import { pendingApprovalAtom, activeThreadIdAtom } from '../store/agentStore'

const TOOL_INFO: Record<string, { label: string; describe: (a: Record<string, any>) => string }> = {
  write_to_file: { label: 'Write File', describe: a => a.file_path || a.filePath || 'unknown file' },
  multi_replace_file_content: { label: 'Edit File', describe: a => a.file_path || a.filePath || 'unknown file' },
  run_command: { label: 'Run Command', describe: a => a.command_line || a.command || 'unknown command' },
  generate_image: { label: 'Generate Image', describe: a => a.prompt?.slice(0, 80) || 'image' },
  search_web: { label: 'Web Search', describe: a => a.query || 'search' },
  save_memory: { label: 'Save Memory', describe: a => a.content?.slice(0, 60) || 'memory' },
}
const friendlyName = (tool: string) => TOOL_INFO[tool]?.label || tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const friendlyDesc = (tool: string, args: Record<string, any>) => TOOL_INFO[tool]?.describe(args) || ''

const ApprovalCard: React.FC = () => {
  const approval = useAtomValue(pendingApprovalAtom)
  const threadId = useAtomValue(activeThreadIdAtom)
  const setPendingApproval = useSetAtom(pendingApprovalAtom)
  const [remember, setRemember] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (!approval) return null
  const label = friendlyName(approval.toolName)
  const desc = friendlyDesc(approval.toolName, approval.args)
  const respond = (approved: boolean) => {
    window.api.respondToApproval(threadId, { approved, remember })
    setPendingApproval(null)
  }
  return (
    <div className="approval-card">
      <div className="approval-header">
        <Shield size={14} className="approval-shield" />
        <span className="approval-title">Allow {label}?</span>
      </div>
      {desc && <div className="approval-desc">{desc}</div>}
      <button className="approval-expand-btn" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{expanded ? 'Hide details' : 'Details'}</span>
      </button>
      {expanded && <pre className="approval-args">{JSON.stringify(approval.args, null, 2)}</pre>}
      <div className="approval-footer">
        <label className="approval-remember">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span>Always allow</span>
        </label>
        <div className="approval-actions">
          <button className="settings-action-btn" onClick={() => respond(false)}><X size={12} /><span>Deny</span></button>
          <button className="settings-action-btn settings-action-primary" onClick={() => respond(true)}><Check size={12} /><span>Allow</span></button>
        </div>
      </div>
    </div>
  )
}
export default ApprovalCard
