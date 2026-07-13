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
    } catch (err: unknown) {
      toast.error('Could not initiate the sign-in process. Please try again.', err)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
      setPending(false)
      setError('Could not open the sign-in page. Please try again.')
    }
  }
  return (
    <div className="flex flex-col items-center justify-center flex-1 bg-oc-base text-tx-main p-6 font-sans select-none">
      <div className="w-full max-w-sm flex flex-col items-center">
        <img src={logo} className="h-16 w-16 mb-6 object-contain" alt="OrchCode Logo" />
        <h1 className="text-2xl font-bold text-tx-bright mb-2 tracking-tight">
          Welcome to OrchCode
        </h1>
        <p className="text-sm text-tx-sub text-center mb-8 leading-relaxed">
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
            className="w-full flex items-center justify-center gap-3 bg-tx-bright hover:bg-tx-main text-oc-base font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 outline-none focus-visible:ring-2 focus-visible:ring-tx-sub focus-visible:ring-offset-2 focus-visible:ring-offset-oc-base"
          >
            {pending ? (
              <>
                <span className="w-[18px] h-[18px] border-2 border-oc-base/30 border-t-oc-base rounded-full animate-spin flex-shrink-0" />
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
          <p className="text-xs text-tx-dim mt-3 text-center">
            Complete sign-in in the browser window that just opened.
          </p>
        )}
        {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
      </div>
    </div>
  )
}
