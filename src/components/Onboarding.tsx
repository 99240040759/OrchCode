import { openUrl } from "@tauri-apps/plugin-opener";
import { Titlebar } from "./ui/Titlebar";
import { Button } from "./ui/Button";
import { useAuthStore } from "../lib/auth";

const TERMS_URL = "https://orch.live/terms";
const PRIVACY_URL = "https://orch.live/privacy";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function Onboarding() {
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  return (
    <div className="Onboarding">
      <Titlebar className="Onboarding-titlebar" />
      <div className="Onboarding-content">
        <img src="/icon.png" alt="" className="Onboarding-logo-img" />
        <h1 className="Onboarding-title">Welcome to Orch Code</h1>
        <p className="Onboarding-sub">
          Your AI software engineer, right on your desktop. Sign in to start planning, building,
          and shipping.
        </p>

        <Button
          className="GoogleBtn"
          onClick={() => void signInWithGoogle()}
          disabled={signingIn}
          aria-busy={signingIn}
        >
          <img src="/google.svg" alt="" className="GoogleIcon" />
          <span>{signingIn ? "Waiting for Google…" : "Continue with Google"}</span>
        </Button>

        {error && (
          <div className="Onboarding-err" role="alert">
            {error}
          </div>
        )}

        <p className="Onboarding-legal">
          By continuing you agree to the <ExternalLink href={TERMS_URL}>Terms of Service</ExternalLink>{" "}
          and acknowledge the <ExternalLink href={PRIVACY_URL}>Privacy Policy</ExternalLink>.
        </p>
      </div>
    </div>
  );
}

export default Onboarding;
