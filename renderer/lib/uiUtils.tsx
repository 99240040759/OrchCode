import React from 'react'
import { ClipboardList, BookOpen, FileText } from 'lucide-react'

// ─── Artifact Helpers ─────────────────────────────────────────────────────────

export function isAgentArtifact(fileName: string): boolean {
  return (
    fileName === 'implementation_plan.md' || fileName === 'walkthrough.md' || fileName === 'task.md'
  )
}

export function getDisplayName(fileName: string): string {
  if (fileName === 'implementation_plan.md') return 'Implementation Plan'
  if (fileName === 'walkthrough.md') return 'Walkthrough'
  if (fileName === 'task.md') return 'Task List'
  return fileName.split(/[/\\]/).pop() ?? fileName
}

/** Single source of truth for artifact icons — uses Lucide. */
export function getArtifactIcon(name: string, size = 15): React.ReactNode {
  if (name === 'implementation_plan.md') {
    return <ClipboardList size={size} className="text-accent-purple flex-shrink-0" />
  }
  if (name === 'walkthrough.md') {
    return <BookOpen size={size} className="text-accent-green flex-shrink-0" />
  }
  return <FileText size={size} className="icon-secondary" />
}

// ─── Path Utilities ───────────────────────────────────────────────────────────

/**
 * Returns the relative directory path of a file within a workspace.
 * e.g. getRelativeDirPath('/proj/src/foo.ts', '/proj') => 'src'
 */
export function getRelativeDirPath(filePath: string, workspacePath?: string): string {
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

// ─── Google Icon ──────────────────────────────────────────────────────────────

export const GoogleIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className="flex-shrink-0"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

export function sanitizeHtml(html: string): string {
  const parser = new DOMParser(), doc = parser.parseFromString(html, 'text/html')
  const clean = (node: Node) => {
    let child = node.firstChild
    while (child) {
      const next = child.nextSibling
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement, tag = el.tagName.toLowerCase()
        const ALLOWED = ['p', 'br', 'strong', 'em', 'code', 'pre', 'span', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'details', 'summary', 'svg', 'path', 'rect', 'polyline', 'button']
        if (!ALLOWED.includes(tag)) el.remove()
        else {
          if (tag === 'button' && !el.classList.contains('code-block-copy-btn')) { el.remove(); child = next; continue }
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase(), val = attr.value
            if (name.startsWith('on')) el.removeAttribute(attr.name)
            else if (name === 'href' && !val.startsWith('http://') && !val.startsWith('https://') && !val.startsWith('file://')) el.removeAttribute(attr.name)
            else if (name === 'src' && !val.startsWith('http://') && !val.startsWith('https://') && !val.startsWith('file://') && !val.startsWith('data:')) el.removeAttribute(attr.name)
          }
          clean(child)
        }
      }
      child = next
    }
  }
  clean(doc.body); return doc.body.innerHTML
}

// ─── Primitives ───────────────────────────────────────────────────────────────

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string | React.ReactNode
  title: string
  description?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  className = '',
  ...props
}) => (
  <div className={`empty-state-root ${className}`} {...props}>
    {icon && <div className="empty-state-icon">{icon}</div>}
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-desc-prim">{description}</p>}
  </div>
)

// ─── Error Boundary ───────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from 'react'
import Lottie from 'lottie-react'
import errorAnimation from '../assets/error.json'

interface ErrorBoundaryProps { children: ReactNode; name?: string; fallback?: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error: Error | null }
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null }
  public static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { hasError: true, error } }
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error(`Uncaught error in [${this.props.name || 'Boundary'}]:`, error, errorInfo) }
  private handleReload = () => window.location.reload()
  private handleReset = () => this.setState({ hasError: false, error: null })
  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      if (this.props.name) {
        return (
          <div className="panel-error-fallback">
            <h3 className="panel-error-fallback-title">{this.props.name} Error</h3>
            <p className="panel-error-fallback-desc">{this.state.error?.message || 'Component crashed.'}</p>
            <button onClick={this.handleReset} className="error-boundary-button panel-error-fallback-btn">Reset Panel</button>
          </div>
        )
      }
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-lottie-wrapper">
            <Lottie animationData={errorAnimation} loop={true} className="error-boundary-lottie" />
          </div>
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-subtitle">{this.state.error?.message || 'An unexpected application crash has occurred.'}</p>
          <button onClick={this.handleReload} className="error-boundary-button">Reload Application</button>
        </div>
      )
    }
    return this.props.children
  }
}
