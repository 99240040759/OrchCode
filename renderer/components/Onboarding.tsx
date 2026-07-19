import React from 'react'
import { useAuthStore } from '../lib/authStore'
import logo from '../assets/logo.png'
import googleLogo from '../assets/google.svg'

export function Onboarding(): React.JSX.Element {
  const { login, pending, error } = useAuthStore()

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
            void login()
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
                <span>Complete sign-in in browser...</span>
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
            After signing in, click &quot;Open&quot; when your browser asks to return to Orch.
          </p>
        )}
        {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
      </div>
    </div>
  )
}
