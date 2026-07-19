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
  pending: boolean
  error: string | undefined
  init: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

function getUser(session: AuthSession | undefined): UserProfile | undefined {
  return session?.user
}

let _authUnsub: (() => void) | undefined = undefined
let _authErrorUnsub: (() => void) | undefined = undefined
let initPromise: Promise<void> | undefined = undefined
let _authVersion = 0

async function applySessionFromMain(
  version: number,
  set: (partial: Partial<AuthStore>) => void
): Promise<void> {
  const session = await window.api.authGetSession()
  if (version !== _authVersion) return
  set({
    session: session ?? undefined,
    user: getUser(session ?? undefined),
    initialized: true,
    pending: false
  })
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  session: undefined,
  user: undefined,
  initialized: false,
  pending: false,
  error: undefined,
  init: async () => {
    if (get().initialized) return
    if (initPromise) return initPromise
    const version = ++_authVersion
    initPromise = (async () => {
      _authUnsub?.()
      _authErrorUnsub?.()
      _authUnsub = window.api.onAuthChange(() => {
        void applySessionFromMain(version, set)
      })
      _authErrorUnsub = window.api.onAuthError(({ message }) => {
        if (version !== _authVersion) return
        set({ pending: false, error: message })
        toast.error(message)
      })
      try {
        await applySessionFromMain(version, set)
      } catch (err: unknown) {
        toast.error('Failed to restore authentication session.', err)
        if (version !== _authVersion) return
        set({ session: undefined, user: undefined, initialized: true, pending: false })
      }
    })()
    try {
      await initPromise
    } finally {
      initPromise = undefined
    }
  },
  login: async () => {
    set({ pending: true, error: undefined })
    try {
      await window.api.authStart()
    } catch (err: unknown) {
      set({ pending: false, error: 'Could not open the sign-in page. Please try again.' })
      toast.error('Could not initiate the sign-in process.', err)
    }
  },
  logout: async () => {
    _authVersion++
    _authUnsub?.()
    _authUnsub = undefined
    _authErrorUnsub?.()
    _authErrorUnsub = undefined
    initPromise = undefined
    set({ session: undefined, user: undefined, initialized: false, pending: false, error: undefined })
    await window.api.authSignOut()
    useThreadStore.getState().reset()
    await get().init()
  }
}))

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _authUnsub?.()
    _authUnsub = undefined
    _authErrorUnsub?.()
    _authErrorUnsub = undefined
    _authVersion++
  })
}
