import React, { useRef, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { activeThreadIdAtom } from '../store/agentStore'

function createDebounce(fn: () => void, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = () => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(), delay)
  }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId)
  }
  return debounced
}

export interface TerminalViewHandle {
  fit: () => void
}

interface TerminalViewProps {
  workspacePath?: string
}

const TerminalView = React.forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ workspacePath }, ref) => {
    const conversationId = useAtomValue(activeThreadIdAtom)

    const conversationIdRef = useRef(conversationId)
    conversationIdRef.current = conversationId

    const termContainerRef = useRef<HTMLDivElement>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const ptyIdRef = useRef<string | null>(null)
    const unsubDataRef = useRef<(() => void) | null>(null)
    const unsubExitRef = useRef<(() => void) | null>(null)

    React.useImperativeHandle(ref, () => ({
      fit: () => {
        try {
          if (termContainerRef.current && termContainerRef.current.clientWidth > 0) {
            fitAddonRef.current?.fit()
          }
        } catch {}
      }
    }))

    useEffect(() => {
      if (!termContainerRef.current) return
      let active = true
      let fitTimeout: NodeJS.Timeout | null = null

      const rootStyle = getComputedStyle(document.documentElement)
      const bgEditor = rootStyle.getPropertyValue('--bg-editor').trim() || '#0f0f11'
      const textPrimary = rootStyle.getPropertyValue('--text-primary').trim() || '#f3f3f3'
      const textMuted = rootStyle.getPropertyValue('--text-muted').trim() || '#71717a'
      const accentBlue = rootStyle.getPropertyValue('--accent-blue').trim() || '#3b82f6'
      const accentGreen = rootStyle.getPropertyValue('--accent-green').trim() || '#10b981'
      const accentOrange = rootStyle.getPropertyValue('--accent-orange').trim() || '#f59e0b'
      const accentPurple = rootStyle.getPropertyValue('--accent-purple').trim() || '#8b5cf6'
      const accentRed = rootStyle.getPropertyValue('--accent-red').trim() || '#ef4444'

      const term = new XTerm({
        theme: {
          background: bgEditor,
          foreground: textPrimary,
          cursor: textPrimary,
          selectionBackground: 'rgba(255, 255, 255, 0.1)',
          black: '#1c1c1c',
          brightBlack: textMuted,
          red: accentRed,
          brightRed: accentRed,
          green: accentGreen,
          brightGreen: accentGreen,
          yellow: accentOrange,
          brightYellow: accentOrange,
          blue: accentBlue,
          brightBlue: accentBlue,
          magenta: accentPurple,
          brightMagenta: accentPurple,
          cyan: '#06b6d4',
          brightCyan: '#22d3ee',
          white: textPrimary,
          brightWhite: '#ffffff'
        },
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowTransparency: false,
        convertEol: true
      })

      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(webLinksAddon)
      term.open(termContainerRef.current)

      fitTimeout = setTimeout(() => {
        if (active) {
          try {
            fitAddon.fit()
          } catch {}
        }
      }, 50)

      fitAddonRef.current = fitAddon

      const { cols, rows } = term

      window.api.invoke('terminal:create', {
        cols,
        rows,
        cwd: workspacePath,
        conversationId: conversationIdRef.current
      })
        .then((result) => {
          const { id } = result as { id: string }
          if (!active) {
            window.api.invoke('terminal:close', { id }).catch(console.error)
            return
          }
          ptyIdRef.current = id

          unsubDataRef.current = window.api.on('terminal:data', (payload) => {
            const { id: dataId, data } = payload as { id: string; data: string }
            if (dataId === id) term.write(data)
          })

          unsubExitRef.current = window.api.on('terminal:exit', (payload) => {
            const { id: exitId } = payload as { id: string }
            if (exitId === id) {
              term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n')
              ptyIdRef.current = null
            }
          })

          term.onData((data) => {
            if (ptyIdRef.current) window.api.invoke('terminal:input', { id: ptyIdRef.current, data }).catch(() => {})
          })
        })
        .catch((err: any) => {
          if (active) term.write(`\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
        })

      const debouncedResize = createDebounce(() => {
        if (active && termContainerRef.current && termContainerRef.current.clientWidth > 0) {
          try { fitAddon.fit() } catch {}
          if (ptyIdRef.current) {
            window.api.invoke('terminal:resize', { id: ptyIdRef.current, cols: term.cols, rows: term.rows }).catch(() => {})
          }
        }
      }, 100)

      const resizeObs = new ResizeObserver(() => {
        debouncedResize()
      })
      resizeObs.observe(termContainerRef.current)

      return () => {
        active = false
        if (fitTimeout) clearTimeout(fitTimeout)
        debouncedResize.cancel()
        resizeObs.disconnect()
        if (unsubDataRef.current) unsubDataRef.current()
        if (unsubExitRef.current) unsubExitRef.current()
        if (ptyIdRef.current) {
          window.api.invoke('terminal:close', { id: ptyIdRef.current }).catch(() => {})
          ptyIdRef.current = null
        }
        term.dispose()
      }
    }, [workspacePath])

    return (
      <div
        ref={termContainerRef}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--bg-app)',
          padding: '16px 20px'
        }}
      />
    )
  }
)
TerminalView.displayName = 'TerminalView'

export default TerminalView
