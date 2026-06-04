import { style, keyframes } from '@vanilla-extract/css'

export const pulseRing = keyframes({
  '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
  '50%': { opacity: '1', transform: 'scale(1.02)' }
})

export const onboardingContainer = style({
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
  userSelect: 'none'
})

export const onboardingOrb = style({
  position: 'absolute',
  borderRadius: '50%',
  pointerEvents: 'none',
  zIndex: 1
})

export const onboardingOrb1 = style({
  width: '350px',
  height: '350px',
  background: 'radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, rgba(0, 0, 0, 0) 70%)',
  top: '15%',
  left: '10%'
})

export const onboardingOrb2 = style({
  width: '400px',
  height: '400px',
  background: 'radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, rgba(0, 0, 0, 0) 70%)',
  bottom: '10%',
  right: '5%'
})

export const onboardingCard = style({
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
  textAlign: 'center'
})

export const onboardingInner = style({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '32px'
})

export const onboardingLogoContainer = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '12px'
})

export const onboardingLogoIcon = style({ fontSize: '48px', marginBottom: '8px' })

export const onboardingTitle = style({
  fontSize: '28px',
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: '-0.02em',
  margin: 0
})

export const onboardingSubtitle = style({
  fontSize: '14.5px',
  color: '#9c9c9c',
  lineHeight: 1.45,
  margin: 0
})

export const onboardingBtn = style({
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
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    boxShadow: '0 0 15px rgba(255, 255, 255, 0.05)',
    transform: 'translateY(-1px)'
  },
  ':active': {
    transform: 'translateY(0)'
  }
})

export const onboardingBtnText = style({ fontSize: '14px', fontWeight: 600, color: '#ffffff' })

export const onboardingLoading = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '12px'
})

export const onboardingLoadingText = style({ fontSize: '13px', color: '#9c9c9c' })

export const onboardingSpinner = style({
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  border: '2px solid rgba(255, 255, 255, 0.05)',
  borderTopColor: '#3b82f6',
  animation: 'spin 0.8s linear infinite'
})

export const onboardingSpinnerSmall = style({
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  border: '2px solid rgba(255, 255, 255, 0.05)',
  borderTopColor: '#8b5cf6',
  animation: 'spin 0.8s linear infinite',
  marginTop: '8px'
})

export const onboardingWelcome = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '16px',
  width: '100%'
})

export const onboardingAvatarContainer = style({
  position: 'relative',
  width: '96px',
  height: '96px',
  marginBottom: '8px'
})

export const onboardingAvatarImg = style({
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255, 255, 255, 0.1)'
})

export const onboardingAvatarFallback = style({
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  fontSize: '32px',
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid rgba(255, 255, 255, 0.1)'
})

export const onboardingAvatarRing = style({
  position: 'absolute',
  top: '-4px',
  left: '-4px',
  right: '-4px',
  bottom: '-4px',
  borderRadius: '50%',
  border: '2px solid #8b5cf6',
  boxShadow: '0 0 16px rgba(139, 92, 246, 0.4)',
  animation: `${pulseRing} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`
})

export const onboardingWelcomeTitle = style({
  fontSize: '22px',
  fontWeight: 700,
  color: '#ffffff',
  margin: 0
})

export const onboardingWelcomeSubtitle = style({ fontSize: '14px', color: '#9c9c9c', margin: 0 })

export const onboardingError = style({
  fontSize: '12px',
  color: '#ef4444',
  textAlign: 'center',
  margin: 0,
  padding: '6px 12px',
  background: 'rgba(239, 68, 68, 0.08)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderRadius: '6px',
  width: '100%',
  boxSizing: 'border-box'
})
