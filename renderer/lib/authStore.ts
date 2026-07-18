import { create } from 'zustand'
import type { AuthSession } from '../../shared/ipc-contracts'
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

function getUser(session: AuthSession | undefined): UserProfile | undefined {
  return session?.user
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
      let initialFetched = false
      _authUnsub?.()
      _authUnsub = window.api.onAuthChange((session) => {
        if (version !== _authVersion) return
        if (initialFetched) {
          set({
            session: session ?? undefined,
            user: getUser(session ?? undefined)
          })
        }
      })
      try {
        const session = await window.api.authGetSession()
        if (version !== _authVersion) return
        initialFetched = true
        set({
          session: session ?? undefined,
          user: getUser(session ?? undefined),
          initialized: true
        })
      } catch (err: unknown) {
        toast.error('Failed to restore authentication session.', err)
        if (version !== _authVersion) return
        initialFetched = true
        set({ session: undefined, user: undefined, initialized: true })
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _authUnsub?.()
    _authUnsub = undefined
    _authVersion++
  })
}
