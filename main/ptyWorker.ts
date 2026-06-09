import pty from 'node-pty'
import log from 'electron-log'

const proc = process as any

proc.parentPort.on('message', (e: { data: any; ports: Electron.MessagePortMain[] }) => {
  const { type, cols, rows, cwd, shell } = e.data
  if (type === 'init-pty') {
    const [port] = e.ports
    if (!port) return

    log.info(`[ptyWorker] Spawning PTY: shell=${shell}, cwd=${cwd}, cols=${cols}, rows=${rows}`)
    let ptyProcess: any
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      })
    } catch (err: any) {
      log.error(`[ptyWorker] Failed to spawn PTY:`, err)
      try { port.postMessage({ type: 'exit', exitCode: -1, error: err.message }) } catch {}
      process.exit(1)
    }

    port.on('message', (evt: any) => {
      const msg = evt.data
      if (typeof msg === 'string') {
        ptyProcess.write(msg)
      } else if (msg && typeof msg === 'object') {
        if (msg.type === 'resize') {
          try { ptyProcess.resize(msg.cols, msg.rows) } catch (err) { log.debug('[ptyWorker] Resize error:', err) }
        } else if (msg.type === 'close') {
          try { ptyProcess.kill() } catch {}
          process.exit(0)
        }
      }
    })

    ptyProcess.onData((data: string) => {
      try { port.postMessage({ type: 'data', data }) } catch { process.exit(1) }
    })

    ptyProcess.onExit(({ exitCode }: any) => {
      try { port.postMessage({ type: 'exit', exitCode }) } catch {}
      process.exit(0)
    })

    port.start()
  }
})
