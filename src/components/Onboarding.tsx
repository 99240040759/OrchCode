import { Titlebar } from "./ui/Titlebar";
import { Button } from "./ui/Button";
import { useAuthStore } from "../lib/auth";

const TERMS_URL = "https://orch.live/terms";
const PRIVACY_URL = "https://orch.live/privacy";

export function Onboarding() {
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  return (
    <div className="Onboarding">
      <Titlebar className="Onboarding-titlebar" />
      <div className="Onboarding-content">
        <img src="/icon.png" alt="Orch Code Logo" className="Onboarding-logo-img" />
        <h1 className="Onboarding-title">Welcome to Orch Code</h1>
        <p className="Onboarding-sub">
          Your AI software engineer, right on your desktop. Sign in to start planning, building, and shipping.
        </p>

        <Button className="GoogleBtn" onClick={() => void signInWithGoogle()} disabled={signingIn} aria-busy={signingIn}>
          <img src="/google.svg" alt="Google" className="GoogleIcon" style={{ width: 18, height: 18 }} />
          <span>{signingIn ? "Waiting for Google…" : "Continue with Google"}</span>
        </Button>

        {error && <div className="Onboarding-err" role="alert">{error}</div>}

        <p className="Onboarding-legal">
          By continuing you agree to the{" "}
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">Terms of Service</a>
          {" "}and acknowledge the{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
