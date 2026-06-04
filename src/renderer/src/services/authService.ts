import type { UserProfile } from '../../../preload/index.d'

export const authService = {
  startGoogleAuth: async (): Promise<UserProfile | null> => {
    try {
      return await window.authBridge.startGoogleAuth()
    } catch (err) {
      console.error('[authService] startGoogleAuth failed:', err)
      throw err
    }
  },

  logout: async (): Promise<boolean> => {
    try {
      return await window.authBridge.logout()
    } catch (err) {
      console.error('[authService] logout failed:', err)
      return false
    }
  },

  getAuthUser: async (): Promise<UserProfile | null> => {
    try {
      return await window.authBridge.getAuthUser()
    } catch (err) {
      console.error('[authService] getAuthUser failed:', err)
      return null
    }
  },

  openMainAndCloseOnboarding: async (): Promise<void> => {
    try {
      await window.authBridge.openMainAndCloseOnboarding()
    } catch (err) {
      console.error('[authService] openMainAndCloseOnboarding failed:', err)
      throw err
    }
  },

  onAuthStatusChanged: (callback: (user: UserProfile | null) => void): (() => void) => {
    return window.authBridge.onAuthStatusChanged((user) => {
      try {
        callback(user)
      } catch (err) {
        console.error('[authService] Error in auth status callback:', err)
      }
    })
  }
}
