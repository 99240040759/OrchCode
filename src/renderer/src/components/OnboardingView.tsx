import React, { useState } from 'react'

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

export const OnboardingView: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)

  React.useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.id = 'onboarding-styles'
    styleEl.innerHTML = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes pulse-ring {
        0%, 100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.02); }
      }
      .onboarding-btn {
        transition: all 0.2s ease-in-out;
      }
      .onboarding-btn:hover {
        background-color: rgba(255, 255, 255, 0.07) !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
        box-shadow: 0 0 15px rgba(255, 255, 255, 0.05) !important;
        transform: translateY(-1px);
      }
      .onboarding-btn:active {
        transform: translateY(0);
      }
    `
    document.head.appendChild(styleEl)
    return () => {
      styleEl.remove()
    }
  }, [])

  const handleSignIn = async () => {
    setLoading(true)
    try {
      const profile = await (window as any).api.startGoogleAuth()
      if (profile) {
        setUser(profile)
        // Wait 2.5 seconds for the welcome animation to play before transitioning
        setTimeout(() => {
          ;(window as any).api.openMainAndCloseOnboarding()
        }, 2500)
      } else {
        setLoading(false)
      }
    } catch (err) {
      setLoading(false)
      console.error('Onboarding Sign-in failed:', err)
    }
  }

  return (
    <div style={styles.container}>
      {/* Background ambient glowing orbs */}
      <div style={styles.orb1} />
      <div style={styles.orb2} />

      <div style={styles.card}>
        {!user ? (
          <div style={styles.innerContent}>
            <div style={styles.logoContainer}>
              <div style={styles.logoIcon}>☄️</div>
              <h1 style={styles.title}>Orch Code</h1>
              <p style={styles.subtitle}>Supercharge your development agentic experience.</p>
            </div>

            {loading ? (
              <div style={styles.loadingWrapper}>
                <div style={styles.spinner} />
                <span style={styles.loadingText}>Connecting to Google Auth...</span>
              </div>
            ) : (
              <button className="onboarding-btn" style={styles.signInButton} onClick={handleSignIn}>
                <GoogleIcon />
                <span style={styles.buttonText}>Sign In with Google</span>
              </button>
            )}
          </div>
        ) : (
          <div style={styles.welcomeWrapper}>
            <div style={styles.avatarContainer}>
              {user.photoUrl ? (
                <img src={user.photoUrl} alt={user.name} style={styles.avatarImg} referrerPolicy="no-referrer" />
              ) : (
                <div style={styles.avatarFallback}>
                  {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <div style={styles.avatarRing} />
            </div>
            <h2 style={styles.welcomeTitle}>Welcome back, {user.name}!</h2>
            <p style={styles.welcomeSubtitle}>Preparing your workspace...</p>
            <div style={styles.spinnerSmall} />
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    backgroundColor: '#161616',
    fontFamily: "'Outfit', sans-serif",
    position: 'relative',
    overflow: 'hidden',
    userSelect: 'none',
  },
  orb1: {
    position: 'absolute',
    width: '350px',
    height: '350px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, rgba(0,0,0,0) 70%)',
    top: '15%',
    left: '10%',
    zIndex: 1,
    pointerEvents: 'none',
  },
  orb2: {
    position: 'absolute',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, rgba(0,0,0,0) 70%)',
    bottom: '10%',
    right: '5%',
    zIndex: 1,
    pointerEvents: 'none',
  },
  card: {
    width: '420px',
    padding: '40px',
    borderRadius: '16px',
    backgroundColor: 'rgba(30, 30, 30, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  innerContent: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '32px',
  },
  logoContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  logoIcon: {
    fontSize: '48px',
    marginBottom: '8px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '14.5px',
    color: '#9c9c9c',
    lineHeight: '1.45',
  },
  signInButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    padding: '12px 18px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    cursor: 'pointer',
    transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  buttonText: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#ffffff',
  },
  loadingWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  loadingText: {
    fontSize: '13px',
    color: '#9c9c9c',
  },
  spinner: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 255, 255, 0.05)',
    borderTopColor: '#3b82f6',
    animation: 'spin 0.8s linear infinite',
  },
  welcomeWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    width: '100%',
  },
  avatarContainer: {
    position: 'relative',
    width: '96px',
    height: '96px',
    marginBottom: '8px',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid rgba(255, 255, 255, 0.1)',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    fontSize: '32px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid rgba(255, 255, 255, 0.1)',
  },
  avatarRing: {
    position: 'absolute',
    top: '-4px',
    left: '-4px',
    right: '-4px',
    bottom: '-4px',
    borderRadius: '50%',
    border: '2px solid #8b5cf6',
    boxShadow: '0 0 16px rgba(139, 92, 246, 0.4)',
    animation: 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  },
  welcomeTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#ffffff',
  },
  welcomeSubtitle: {
    fontSize: '14px',
    color: '#9c9c9c',
  },
  spinnerSmall: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: '2px solid rgba(255, 255, 255, 0.05)',
    borderTopColor: '#8b5cf6',
    animation: 'spin 0.8s linear infinite',
    marginTop: '8px',
  },
}


