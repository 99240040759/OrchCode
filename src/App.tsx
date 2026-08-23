import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "react-error-boundary";
import { useAuthStore } from "./lib/auth";
import { useChatStore } from "./lib/store";
import { useUpdaterStore } from "./lib/store";
import { ChatPanel } from "./components/ChatPanel";
import { Greeting, Onboarding } from "./components/screens";
import { Sidebar } from "./components/Sidebar";
import { Button } from "./components/ui/Button";
import { Titlebar } from "./components/ui/Titlebar";
import { TooltipProvider } from "./components/ui/Tooltip";

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="AppShell">
      <Titlebar
        title="Orch"
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <div className="AppShell-body">
        {sidebarOpen && <Sidebar />}
        <div className="Main">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}

function AppError({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="AuthLoading">
      <div className="FatalError" role="alert">
        <h2 className="FatalError-title">Something went wrong</h2>
        <p className="FatalError-message">{error.message}</p>
        <Button className="FatalError-retry" onClick={resetErrorBoundary}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function Root() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const justSignedIn = useAuthStore((s) => s.justSignedIn);
  const dismissGreeting = useAuthStore((s) => s.dismissGreeting);
  const initializeAuth = useAuthStore((s) => s.initialize);
  const initializeChat = useChatStore((s) => s.initialize);
  const startUpdater = useUpdaterStore((s) => s.start);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (status === "loading") return;
    void getCurrentWindow().show();
    void startUpdater();
  }, [status, startUpdater]);

  useEffect(() => {
    if (status !== "signedIn") return;
    void initializeChat();
  }, [status, initializeChat]);

  if (status === "loading") {
    return (
      <div className="AuthLoading">
        <div className="Spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (status === "signedOut") return <Onboarding />;
  if (justSignedIn) return <Greeting user={user} onDone={dismissGreeting} />;
  return <AppShell />;
}

export default function App() {
  return (
    <ErrorBoundary FallbackComponent={AppError}>
      <TooltipProvider delayDuration={120} disableHoverableContent>
        <Root />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
