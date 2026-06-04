import React, { useState } from 'react'

import { GoogleIcon } from '../lib/uiUtils'
import { toast } from 'sonner'
import * as styles from './OnboardingView.css'

export const OnboardingView: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<{ name?: string; email?: string; photoUrl?: string } | null>(
    null
  )

  // Transition to main window after successful sign-in, with cleanup on unmount
  React.useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      window.authBridge.openMainAndCloseOnboarding()
    }, 1200)
    return () => clearTimeout(timer)
  }, [user])

  const handleSignIn = async () => {
    setLoading(true)
    setAuthError(null)
    try {
      const profile = await window.authBridge.startGoogleAuth()
      if (profile) {
        setUser(profile)
        // Transition is handled in a useEffect below so it cleans up on unmount
        setLoading(false)
      } else {
        setLoading(false)
        setAuthError('Sign-in was cancelled or no profile returned.')
        toast.error('Sign-in cancelled. Please try again.')
      }
    } catch (err: any) {
      setLoading(false)
      const msg = err?.message || 'Unknown error'
      setAuthError(msg)
      toast.error(`Sign-in failed: ${msg}`)
      console.error('Onboarding Sign-in failed:', err)
    }
  }

  return (
    <div className={styles.onboardingContainer}>
      <div className={`${styles.onboardingOrb} ${styles.onboardingOrb1}`} />
      <div className={`${styles.onboardingOrb} ${styles.onboardingOrb2}`} />

      <div className={styles.onboardingCard}>
        {!user ? (
          <div className={styles.onboardingInner}>
            <div className={styles.onboardingLogoContainer}>
              <div className={styles.onboardingLogoIcon}>☄️</div>
              <h1 className={styles.onboardingTitle}>Orch Code</h1>
              <p className={styles.onboardingSubtitle}>
                Supercharge your development agentic experience.
              </p>
            </div>

            {loading ? (
              <div className={styles.onboardingLoading}>
                <div className={styles.onboardingSpinner} />
                <span className={styles.onboardingLoadingText}>Connecting to Google Auth...</span>
              </div>
            ) : (
              <>
                <button className={styles.onboardingBtn} onClick={handleSignIn}>
                  <GoogleIcon size={18} />
                  <span className={styles.onboardingBtnText}>Sign In with Google</span>
                </button>
                {authError && <p className={styles.onboardingError}>{authError}</p>}
              </>
            )}
          </div>
        ) : (
          <div className={styles.onboardingWelcome}>
            <div className={styles.onboardingAvatarContainer}>
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.name}
                  className={styles.onboardingAvatarImg}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className={styles.onboardingAvatarFallback}>
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <div className={styles.onboardingAvatarRing} />
            </div>
            <h2 className={styles.onboardingWelcomeTitle}>Welcome back, {user.name}!</h2>
            <p className={styles.onboardingWelcomeSubtitle}>Preparing your workspace...</p>
            <div className={styles.onboardingSpinnerSmall} />
          </div>
        )}
      </div>
    </div>
  )
}
