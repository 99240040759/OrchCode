import { useState, useEffect } from "react";
import { FcGoogle } from 'react-icons/fc';
import { VscLoading } from 'react-icons/vsc';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { el } from '@/lib/electron';

import logo from '../../logo.png';

export default function Onboarding() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuthStore(s => s.setSession);
  useEffect(() => el.onSessionReceived((s) => { if (s) setSession(s); }), [setSession]);
  const handleGoogleSignIn = async () => { setLoading(true); setError(null); try { await el.startOAuth(); } catch (e: any) { setError(e.message || 'Sign in failed'); setLoading(false); } };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-8 select-none bg-background">
      <div className="flex flex-col items-center gap-2 text-center">
        <img src={logo} className="size-16 mb-1 object-contain" alt="Logo" />
        <div className="text-2xl font-semibold tracking-tight text-foreground">OrchCode</div>
        <p className="text-xs text-foreground/40 max-w-56">AI-powered coding agent. Sign in to get started.</p>
      </div>
      <div className="w-full max-w-64 flex flex-col gap-2.5">
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={handleGoogleSignIn} disabled={loading} id="google-signin-btn">
          {loading ? <VscLoading className="size-3.5 animate-spin" /> : <FcGoogle className="size-3.5" />}
          {loading ? 'Opening browser…' : 'Continue with Google'}
        </Button>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
      </div>
      <p className="text-[11px] text-foreground/25 text-center max-w-52">Your browser will open for authentication. Return here after signing in.</p>
    </div>
  );
}
