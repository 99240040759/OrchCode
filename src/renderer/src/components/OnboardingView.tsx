import React, { useState } from 'react'
import './OnboardingView.css'
import { GoogleIcon } from '../lib/uiUtils'
import { toast } from 'sonner'

export const OnboardingView: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<{ name?: string; email?: string; photoUrl?: string } | null>(null)

  const handleSignIn = async () => {
    setLoading(true)
    setAuthError(null)
    try {
      const profile = await window.api.startGoogleAuth()
      if (profile) {
        setUser(profile)
        setTimeout(() => {
          window.api.openMainAndCloseOnboarding()
        }, 2500)
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
    <div className="onboarding-container">
      <div className="onboarding-orb onboarding-orb-1" />
      <div className="onboarding-orb onboarding-orb-2" />

      <div className="onboarding-card">
        {!user ? (
          <div className="onboarding-inner">
            <div className="onboarding-logo-container">
              <div className="onboarding-logo-icon">☄️</div>
              <h1 className="onboarding-title">Orch Code</h1>
              <p className="onboarding-subtitle">Supercharge your development agentic experience.</p>
            </div>

            {loading ? (
              <div className="onboarding-loading">
                <div className="onboarding-spinner" />
                <span className="onboarding-loading-text">Connecting to Google Auth...</span>
              </div>
            ) : (
              <>
                <button className="onboarding-btn" onClick={handleSignIn}>
                  <GoogleIcon size={18} />
                  <span className="onboarding-btn-text">Sign In with Google</span>
                </button>
                {authError && (
                  <p className="onboarding-error">{authError}</p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="onboarding-welcome">
            <div className="onboarding-avatar-container">
              {user.photoUrl ? (
                <img src={user.photoUrl} alt={user.name} className="onboarding-avatar-img" referrerPolicy="no-referrer" />
              ) : (
                <div className="onboarding-avatar-fallback">
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <div className="onboarding-avatar-ring" />
            </div>
            <h2 className="onboarding-welcome-title">Welcome back, {user.name}!</h2>
            <p className="onboarding-welcome-subtitle">Preparing your workspace...</p>
            <div className="onboarding-spinner-small" />
          </div>
        )}
      </div>
    </div>
  )
}
