import { EventEmitter } from 'node:events'

type AuthEventMap = {
  'open-main-and-close-onboarding': []
  'logged-out': []
}

class AuthEventEmitter extends EventEmitter {
  emit<K extends keyof AuthEventMap>(event: K, ...args: AuthEventMap[K]): boolean {
    return super.emit(event, ...args)
  }
  on<K extends keyof AuthEventMap>(event: K, listener: (...args: AuthEventMap[K]) => void): this {
    return super.on(event, listener)
  }
  once<K extends keyof AuthEventMap>(event: K, listener: (...args: AuthEventMap[K]) => void): this {
    return super.once(event, listener)
  }
}

export const authEvents = new AuthEventEmitter()
