import React, { useRef, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { activeThreadIdAtom } from '../store/agentStore'
import debounce from 'lodash.debounce'
import { getOrchThemeColors } from '../lib/sharedUtils'

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
    const workspacePathRef = useRef(workspacePath)
    conversationIdRef.current = conversationId
    workspacePathRef.current = workspacePath

    const termContainerRef = useRef<HTMLDivElement>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const ptyIdRef = useRef<string | null>(null)

    React.useImperativeHandle(ref, () => ({
      fit: () => {
        try {
          if (termContainerRef.current && termContainerRef.current.clientWidth > 0) {
            fitAddonRef.current?.fit()
          }
        } catch (err) { console.debug('[TerminalView] Parse error:', err) }
      }
    }))

    useEffect(() => {
      if (!termContainerRef.current) return
      let active = true, fitTimeout: NodeJS.Timeout | null = null
      const { bgApp, textPrimary, textMuted, accentBlue, accentGreen, accentOrange, accentPurple, accentRed } = getOrchThemeColors()
      const term = new XTerm({
        theme: {
          background: bgApp,
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
      try { fitAddon.fit() } catch (err) { console.debug('[TerminalView] Fit error:', err) }

      const terminalId = `pty-${self.crypto.randomUUID()}`
      ptyIdRef.current = terminalId
      let activePort: MessagePort | null = null

      const onMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'terminal-port-transfer' && event.data.id === terminalId) {
          window.removeEventListener('message', onMessage)
          const p = event.ports[0]
          if (p) {
            if (!active) return p.close()
            activePort = p
            p.onmessage = (e) => {
              if (!active) return
              if (e.data.type === 'data') term.write(e.data.data)
              else if (e.data.type === 'exit') { term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n'); ptyIdRef.current = null }
            }
            p.start()
          }
        }
      }
      window.addEventListener('message', onMessage)
      window.api.onTerminalPort(terminalId)

      fitTimeout = setTimeout(() => {
        if (active && termContainerRef.current && termContainerRef.current.clientWidth > 0) {
          try { fitAddon.fit() } catch (err) { console.debug('[TerminalView] Fit error:', err) }
          if (activePort) activePort.postMessage({ type: 'resize', cols: term.cols, rows: term.rows })
        }
      }, 50)
      fitAddonRef.current = fitAddon
      const { cols, rows } = term

      window.api.invoke('terminal:create', {
        id: terminalId,
        cols,
        rows,
        cwd: workspacePathRef.current,
        conversationId: conversationIdRef.current
      }).catch((err: any) => {
        if (active) term.write(`\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
      })

      term.onData((data) => { if (activePort) activePort.postMessage(data) })

      const debouncedResize = debounce(() => {
        if (active && termContainerRef.current && termContainerRef.current.clientWidth > 0) {
          try { fitAddon.fit() } catch (err) { console.debug('[TerminalView] Resize fit error:', err) }
          if (activePort) activePort.postMessage({ type: 'resize', cols: term.cols, rows: term.rows })
        }
      }, 100)
      const resizeObs = new ResizeObserver(() => debouncedResize())
      resizeObs.observe(termContainerRef.current)

      return () => {
        active = false
        window.removeEventListener('message', onMessage)
        if (fitTimeout) clearTimeout(fitTimeout)
        debouncedResize.cancel()
        resizeObs.disconnect()
        if (activePort) try { activePort.close() } catch {}
        if (ptyIdRef.current) {
          window.api.invoke('terminal:close', { id: ptyIdRef.current }).catch(() => {})
          ptyIdRef.current = null
        }
        term.dispose()
      }
    }, [conversationId])

    return <div ref={termContainerRef} className="terminal-container" />
  }
)
TerminalView.displayName = 'TerminalView'

export default TerminalView
