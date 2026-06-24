import { useState, useEffect } from "react";
import { FcGoogle } from 'react-icons/fc';
import { VscLoading } from 'react-icons/vsc';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { el } from '@/lib/electron';
export default function Onboarding() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuthStore(s => s.setSession);
  useEffect(() => el.onSessionReceived((s) => { if (s) setSession(s); }), [setSession]);
  const handleGoogleSignIn = async () => {
    setLoading(true); setError(null);
    try { await el.startOAuth(); } catch (e: any) { setError(e.message || 'Sign in failed'); setLoading(false); }
  };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-8 select-none bg-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-5xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/40 bg-clip-text text-transparent">OrchCode</div>
        <p className="text-sm text-muted-foreground max-w-[280px]">AI-powered coding agent. Sign in to get started.</p>
      </div>
      <div className="w-full max-w-[280px] flex flex-col gap-3">
        <Button variant="outline" className="w-full h-10 gap-2.5 text-sm font-medium border border-border hover:bg-muted/50 transition-colors" onClick={handleGoogleSignIn} disabled={loading} id="google-signin-btn">
          {loading ? <VscLoading className="size-4 animate-spin" /> : <FcGoogle className="size-4" />}
          {loading ? 'Opening browser…' : 'Continue with Google'}
        </Button>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
      </div>
      <p className="text-mini text-muted-foreground/50 text-center max-w-[240px]">Your browser will open for authentication. Return here after signing in.</p>
    </div>
  );
}
