import { WebContentsView } from 'electron'
import { z } from 'zod'
import WindowManager from './windowManager'

function normalizeBrowserUrl(val: string): string {
  const c = val.trim()
  if (!c || c === 'about:blank') return 'about:blank'
  const hasSpace = /\s/.test(c), hasDot = c.includes('.'), isLocal = c.startsWith('localhost') || c.includes('localhost:')
  if (hasSpace || (!hasDot && !isLocal && !/^https?:\/\//i.test(c))) return `https://www.google.com/search?q=${encodeURIComponent(c)}`
  try {
    const parsed = new URL(/^https?:\/\//i.test(c) ? c : `https://${c}`)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Unsupported protocol: ${parsed.protocol}`)
    return parsed.toString()
  } catch { return `https://www.google.com/search?q=${encodeURIComponent(c)}` }
}

function normalizeBounds(b: { x: number; y: number; width: number; height: number }) {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) throw new Error('Bounds must be finite.')
  return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
}

export const browserCommands = {
  'browser:open': {
    schema: z.object({ url: z.string().min(1), bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), conversationId: z.string().optional() }),
    execute: async ({ url, bounds, conversationId }: any, event: any) => {
      const mainWindow = WindowManager.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window not available.')
      let bv = WindowManager.getBrowserView()
      if (bv && WindowManager.getBrowserConversationId() !== conversationId) {
        try { mainWindow.contentView.removeChildView(bv); bv.webContents.close() } catch {}
        bv = null; WindowManager.setBrowserView(null); WindowManager.setBrowserConversationId(null)
      }
      const setupListeners = (view: any, sender: any) => {
        view.webContents.removeAllListeners('page-title-updated')
        view.webContents.removeAllListeners('did-navigate')
        view.webContents.removeAllListeners('did-navigate-in-page')
        view.webContents.on('page-title-updated', (_e: any, title: string) => { try { sender.send('browser:title-updated', title) } catch {} })
        const onNavigate = (_e: any, navUrl: string) => { try { sender.send('browser:url-changed', navUrl) } catch {} }
        view.webContents.on('did-navigate', onNavigate); view.webContents.on('did-navigate-in-page', onNavigate)
      }
      if (bv) {
        bv.setBounds(normalizeBounds(bounds)); try { mainWindow.contentView.addChildView(bv) } catch {}
        setupListeners(bv, event.sender)
        const targetUrl = normalizeBrowserUrl(url)
        if (bv.webContents.getURL() !== targetUrl) await bv.webContents.loadURL(targetUrl)
        return
      }
      const partition = conversationId ? `persist:conversation_${conversationId}` : undefined
      bv = new WebContentsView({ webPreferences: { webSecurity: true, nodeIntegration: false, contextIsolation: true, sandbox: true, partition } })
      WindowManager.setBrowserView(bv); WindowManager.setBrowserConversationId(conversationId || null); mainWindow.contentView.addChildView(bv); bv.setBounds(normalizeBounds(bounds))
      setupListeners(bv, event.sender)
      await bv.webContents.loadURL(normalizeBrowserUrl(url || 'https://google.com'))
    }
  },
  'browser:navigate': { schema: z.object({ url: z.string().min(1) }), execute: ({ url }: any) => { const bv = WindowManager.getBrowserView(); if (!bv) throw new Error('Browser closed.'); return bv.webContents.loadURL(normalizeBrowserUrl(url)) } },
  'browser:back': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoBack()) bv.webContents.goBack() } },
  'browser:forward': { schema: z.object({}), execute: () => { const bv = WindowManager.getBrowserView(); if (bv?.webContents.canGoForward()) bv.webContents.goForward() } },
  'browser:reload': { schema: z.object({}), execute: () => { WindowManager.getBrowserView()?.webContents.reload() } },
  'browser:resize': { schema: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }), execute: (bounds: any) => { WindowManager.getBrowserView()?.setBounds(normalizeBounds(bounds)) } },
  'browser:hide': {
    schema: z.object({}),
    execute: () => {
      const win = WindowManager.getMainWindow(), bv = WindowManager.getBrowserView()
      if (bv && win) { try { win.contentView.removeChildView(bv) } catch {} }
    }
  },
  'browser:close': {
    schema: z.object({}),
    execute: () => {
      const win = WindowManager.getMainWindow(), bv = WindowManager.getBrowserView()
      if (bv) {
        if (win) { try { win.contentView.removeChildView(bv) } catch {} }
        try { bv.webContents.close() } catch {}
        WindowManager.setBrowserView(null); WindowManager.setBrowserConversationId(null)
      }
    }
  }
}
