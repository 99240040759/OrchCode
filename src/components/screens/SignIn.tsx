import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuthStore } from "../../lib/auth";
import { Button } from "../ui/Button";
import { Screen } from "./Screen";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function SignIn() {
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signInWithGoogle);

  return (
    <Screen title="Welcome to Orch" subtitle="Your AI software engineer on the desktop. Sign in to plan, build and ship.">
      <Button variant="primary" size="xl" disabled={signingIn} aria-busy={signingIn} onClick={() => void signIn()}>
        {signingIn ? <span className="spinner" /> : <img src="/google.svg" alt="" className="file-icon" />}
        <span>{signingIn ? "Waiting for Google…" : "Continue with Google"}</span>
      </Button>
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
        </div>
      )}
      <p className="screen-legal">
        By continuing you agree to the <ExternalLink href="https://orch.live/terms">Terms of Service</ExternalLink> and
        acknowledge the <ExternalLink href="https://orch.live/privacy">Privacy Policy</ExternalLink>.
      </p>
    </Screen>
  );
}
