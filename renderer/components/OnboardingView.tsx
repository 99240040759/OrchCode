import React, { useState } from 'react'
import { GoogleIcon } from '../lib/uiUtils'
import { authService } from '../services/services'
import { toast } from 'sonner'
import Lottie from 'lottie-react'
import onboardingAnimation from '../assets/onboarding.json'
import onboardingEntryAnimation from '../assets/onboarding-entry.json'
import onboardingCompleteAnimation from '../assets/onboarding-complete.json'
import { Loader } from 'lucide-react'



export const OnboardingView: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<{ name?: string; email?: string; photoUrl?: string } | null>(null)
  const hasCalledRef = React.useRef(false)
  React.useEffect(() => { const timer = setTimeout(() => setShowSplash(false), 6000); return () => clearTimeout(timer) }, [])
  React.useEffect(() => {
    if (!user || hasCalledRef.current) return
    hasCalledRef.current = true
    authService.completeOnboarding().catch(console.error)
  }, [user])

  const handleSignIn = async () => {
    setLoading(true); setAuthError(null)
    try {
      const profile = await authService.startGoogleAuth()
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
        <div className="onboarding-splash-wrapper">
          <Lottie animationData={onboardingEntryAnimation} loop={false} className="onboarding-splash-lottie" />
        </div>
      ) : !user ? (
        <div className="onboarding-inner">
          <div className="onboarding-logo-container">
            <div className="onboarding-logo-icon">
              <Lottie animationData={onboardingAnimation} loop={true} className="onboarding-logo-lottie" />
            </div>
            <h1 className="onboarding-title">Orch Code</h1>
            <p className="onboarding-subtitle">Supercharge your development agentic experience.</p>
          </div>
          {loading ? (
            <div className="onboarding-loading">
              <Loader className="animate-spin text-accent-blue" size={28} />
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
        <div className="onboarding-complete-wrapper">
          <Lottie animationData={onboardingCompleteAnimation} loop={true} className="onboarding-complete-lottie" />
        </div>
      )}
    </div>
  )
}
