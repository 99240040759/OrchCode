import React, { useState } from 'react'
import { GoogleIcon } from '../lib/uiUtils'
import { toast } from 'sonner'
import Lottie from 'lottie-react'
import onboardingAnimation from '../assets/onboarding.json'
import onboardingEntryAnimation from '../assets/onboarding-entry.json'

export const OnboardingView: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<{ name?: string; email?: string; photoUrl?: string } | null>(null)

  React.useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => window.api.invoke('auth:open-onboarding').catch(console.error), 1200)
    return () => clearTimeout(timer)
  }, [user])

  const handleSignIn = async () => {
    setLoading(true); setAuthError(null)
    try {
      const profile = await window.api.invoke('auth:login') as any
      if (profile) { setUser(profile); setLoading(false) }
      else { setLoading(false); setAuthError('Sign-in was cancelled or no profile returned.'); toast.error('Sign-in cancelled. Please try again.') }
    } catch (err: any) {
      setLoading(false)
      const msg = err?.message || 'Unknown error'
      setAuthError(msg); toast.error(`Sign-in failed: ${msg}`)
      console.error('Onboarding Sign-in failed:', err)
    }
  }

  return (
    <div className="onboarding-container">
      {!user ? (
        <div className="onboarding-inner">
          <div className="onboarding-logo-container">
            <div className="onboarding-logo-icon" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 200, height: 200, margin: '0 auto 8px' }}>
              <Lottie
                animationData={onboardingAnimation}
                loop={true}
                style={{ width: 200, height: 200 }}
              />
            </div>
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
              {authError && <p className="onboarding-error">{authError}</p>}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 480, height: 480 }}>
          <Lottie
            animationData={onboardingEntryAnimation}
            loop={true}
            style={{ width: 480, height: 480 }}
          />
        </div>
      )}
    </div>
  )
}
