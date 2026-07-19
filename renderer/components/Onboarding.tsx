import React, { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../lib/authStore'
import logo from '../assets/logo.png'
import googleLogo from '../assets/google.svg'
import { toast } from '../lib/toast'

export function Onboarding(): React.JSX.Element {
  const { login } = useAuthStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    []
  )
  const handleLogin = async (): Promise<void> => {
    setPending(true)
    setError(undefined)
    timeoutRef.current = setTimeout(() => {
      setPending(false)
      setError('Sign-in timed out. Please try again.')
    }, 300_000)
    try {
      await login()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    } catch (err: unknown) {
      toast.error('Could not initiate the sign-in process. Please try again.', err)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
      setPending(false)
      setError('Could not open the sign-in page. Please try again.')
    }
  }
  return (
    <div className="flex flex-col items-center justify-center flex-1 bg-background text-foreground p-6 font-sans select-none">
      <div className="w-full max-w-sm flex flex-col items-center">
        <img src={logo} className="h-16 w-16 mb-6 object-contain" alt="OrchCode Logo" />
        <h1 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
          Welcome to OrchCode
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-8 leading-relaxed">
          The agentic workspace orchestrator. Sign in with Google to sync your agentic workspaces
          and access tools.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleLogin()
          }}
          className="w-full"
        >
          <button
            type="submit"
            disabled={pending}
            className="w-full flex items-center justify-center gap-3 bg-primary hover:opacity-90 text-primary-foreground font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {pending ? (
              <>
                <span className="w-[18px] h-[18px] border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin flex-shrink-0" />
                <span>Opening browser...</span>
              </>
            ) : (
              <>
                <img src={googleLogo} className="w-[18px] h-[18px] flex-shrink-0" alt="Google" />
                <span>Sign in with Google</span>
              </>
            )}
          </button>
        </form>
        {pending && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Complete sign-in in the browser window that just opened.
          </p>
        )}
        {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
      </div>
    </div>
  )
}
