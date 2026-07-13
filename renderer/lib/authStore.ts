import { create } from 'zustand'
import type { AuthSession } from '../../shared/ipc-contracts'
import * as Sentry from '@sentry/electron/renderer'
import { toast } from './toast'
import { useThreadStore } from './threadStore'

export interface UserProfile {
  name: string
  email: string
  avatarUrl: string
}

interface AuthStore {
  session: AuthSession | undefined
  user: UserProfile | undefined
  initialized: boolean
  init: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

function decodeUser(session: AuthSession | undefined): UserProfile | undefined {
  if (!session) return undefined
  try {
    const parts = session.accessToken.split('.')
    if (parts.length !== 3) return undefined
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (encoded.length % 4)) % 4
    const padded = encoded + '='.repeat(padLen)
    const bytes = Uint8Array.from(window.atob(padded), (char) => char.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    const emailRaw = payload?.email
    const email = typeof emailRaw === 'string' ? emailRaw : ''
    const nameFallback =
      typeof email === 'string' && email.includes('@') ? email.split('@')[0] : 'User'
    return {
      name: payload?.user_metadata?.full_name || payload?.user_metadata?.name || nameFallback,
      email,
      avatarUrl: payload?.user_metadata?.avatar_url || payload?.user_metadata?.picture || ''
    }
  } catch (err: unknown) {
    Sentry.captureException(err)
    return undefined
  }
}

let _authUnsub: (() => void) | undefined = undefined
let initPromise: Promise<void> | undefined = undefined
let _authVersion = 0

export const useAuthStore = create<AuthStore>((set, get) => ({
  session: undefined,
  user: undefined,
  initialized: false,
  init: async () => {
    if (get().initialized) return
    if (initPromise) return initPromise
    const version = ++_authVersion
    initPromise = (async () => {
      let receivedChange = false
      _authUnsub?.()
      _authUnsub = window.api.onAuthChange((session) => {
        if (version !== _authVersion) return
        receivedChange = true
        set({
          session: session ?? undefined,
          user: decodeUser(session ?? undefined),
          initialized: true
        })
      })
      try {
        const session = await window.api.authGetSession()
        if (version !== _authVersion) return
        if (!receivedChange)
          set({
            session: session ?? undefined,
            user: decodeUser(session ?? undefined),
            initialized: true
          })
      } catch (err: unknown) {
        toast.error('Failed to restore authentication session.', err)
        if (version !== _authVersion) return
        if (!receivedChange) set({ session: undefined, user: undefined, initialized: true })
      }
    })()
    try {
      await initPromise
    } finally {
      initPromise = undefined
    }
  },
  login: async () => {
    await window.api.authStart()
  },
  logout: async () => {
    _authVersion++
    _authUnsub?.()
    _authUnsub = undefined
    initPromise = undefined
    set({ session: undefined, user: undefined, initialized: false })
    await window.api.authSignOut()
    useThreadStore.getState().reset()
    await get().init()
  }
}))
