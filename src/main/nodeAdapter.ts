export function nodeAdapter(port: any): any {
  const listeners = new WeakMap()
  return {
    postMessage(message: any, transfer?: any[]) {
      port.postMessage(message, transfer)
    },
    addEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = (data: any) => {
          if (eh && typeof eh === 'object' && 'handleEvent' in eh) {
            eh.handleEvent({ data })
          } else {
            eh({ data })
          }
        }
        port.on('message', l)
        listeners.set(eh, l)
      }
    },
    removeEventListener(type: string, eh: any) {
      if (type === 'message') {
        const l = listeners.get(eh)
        if (l) {
          port.off('message', l)
          listeners.delete(eh)
        }
      }
    }
  }
}
