export const browserService = {
  openBrowser: async (url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void> => {
    try {
      await window.browserBridge.openBrowser({ url, bounds })
    } catch (err) {
      console.error('[browserService] openBrowser failed:', err)
      throw err
    }
  },

  navigateBrowser: async (url: string): Promise<void> => {
    try {
      await window.browserBridge.navigateBrowser(url)
    } catch (err) {
      console.error('[browserService] navigateBrowser failed:', err)
      throw err
    }
  },

  browserBack: async (): Promise<void> => {
    try {
      await window.browserBridge.browserBack()
    } catch (err) {
      console.error('[browserService] browserBack failed:', err)
      throw err
    }
  },

  browserForward: async (): Promise<void> => {
    try {
      await window.browserBridge.browserForward()
    } catch (err) {
      console.error('[browserService] browserForward failed:', err)
      throw err
    }
  },

  browserReload: async (): Promise<void> => {
    try {
      await window.browserBridge.browserReload()
    } catch (err) {
      console.error('[browserService] browserReload failed:', err)
      throw err
    }
  },

  resizeBrowser: async (bounds: { x: number; y: number; width: number; height: number }): Promise<void> => {
    try {
      await window.browserBridge.resizeBrowser(bounds)
    } catch (err) {
      console.error('[browserService] resizeBrowser failed:', err)
      throw err
    }
  },

  closeBrowser: async (): Promise<void> => {
    try {
      await window.browserBridge.closeBrowser()
    } catch (err) {
      console.error('[browserService] closeBrowser failed:', err)
      throw err
    }
  },

  onBrowserTitleUpdated: (callback: (title: string) => void): (() => void) => {
    return window.browserBridge.onBrowserTitleUpdated((title) => {
      try {
        callback(title)
      } catch (err) {
        console.error('[browserService] Error in title update callback:', err)
      }
    })
  },

  onBrowserUrlChanged: (callback: (url: string) => void): (() => void) => {
    return window.browserBridge.onBrowserUrlChanged((url) => {
      try {
        callback(url)
      } catch (err) {
        console.error('[browserService] Error in url change callback:', err)
      }
    })
  }
}
