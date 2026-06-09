import type { UserProfile } from '../../preload/index.d'

export const authService = {
  startGoogleAuth: async (): Promise<UserProfile | null> => {
    try { return await window.api.invoke('auth:login') as UserProfile | null }
    catch (err) { console.error('[authService] startGoogleAuth failed:', err); throw err }
  },

  logout: async (): Promise<boolean> => {
    try { return await window.api.invoke('auth:logout') as boolean }
    catch (err) { console.error('[authService] logout failed:', err); throw err }
  },

  getAuthUser: async (): Promise<UserProfile | null> => {
    try { return await window.api.invoke('auth:get-user') as UserProfile | null }
    catch (err) { console.error('[authService] getAuthUser failed:', err); throw err }
  },



  onAuthStatusChanged: (callback: (user: UserProfile | null) => void): (() => void) => {
    return window.api.on('auth:status-changed', (user) => {
      try { callback(user as UserProfile | null) }
      catch (err) { console.error('[authService] Error in auth status callback:', err); throw err }
    })
  }
}
