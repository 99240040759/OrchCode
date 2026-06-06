import React, { useState } from 'react'
import { GoogleIcon } from '../lib/uiUtils'
import { toast } from 'sonner'
import Lottie from 'lottie-react'
import onboardingAnimation from '../assets/onboarding.json'
import onboardingEntryAnimation from '../assets/onboarding-entry.json'
import onboardingCompleteAnimation from '../assets/onboarding-complete.json'

import type { UserProfile } from '../../../preload/index.d'

export const OnboardingView: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<{ name?: string; email?: string; photoUrl?: string } | null>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 6000)
    return () => clearTimeout(timer)
  }, [])

  React.useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      window.api.invoke('auth:open-onboarding').catch(console.error)
    }, 1600)
    return () => clearTimeout(timer)
  }, [user])

  const handleSignIn = async () => {
    setLoading(true); setAuthError(null)
    try {
      const profile = await window.api.invoke('auth:login') as UserProfile | null
      if (profile) { setUser(profile); setLoading(false) }
      else { setLoading(false); setAuthError('Sign-in was cancelled or no profile returned.'); toast.error('Sign-in cancelled. Please try again.') }
    } catch (err: unknown) {
      setLoading(false)
      const msg = err instanceof Error ? err.message : String(err)
      setAuthError(msg); toast.error(`Sign-in failed: ${msg}`)
      console.error('Onboarding Sign-in failed:', err)
    }
  }

  return (
    <div className="onboarding-container">
      {showSplash ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 480, height: 480 }}>
          <Lottie
            animationData={onboardingEntryAnimation}
            loop={false}
            style={{ width: 480, height: 480 }}
          />
        </div>
      ) : !user ? (
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 300, height: 300 }}>
          <Lottie
            animationData={onboardingCompleteAnimation}
            loop={true}
            style={{ width: 300, height: 300 }}
          />
        </div>
      )}
    </div>
  )
}
