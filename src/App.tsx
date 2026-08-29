import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "react-error-boundary";
import { useAuthStore } from "./lib/auth";
import { useChatStore } from "./lib/store";
import { useUpdaterStore } from "./lib/updater";
import { useWorkspaceStore } from "./lib/workspace";
import { ChatPanel } from "./components/ChatPanel";
import { Greeting, Onboarding } from "./components/screens";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { Sidebar } from "./components/Sidebar";
import { LibraryView } from "./components/LibraryView";
import { ConnectorsView } from "./components/ConnectorsView";
import { Button } from "./components/ui/Button";
import { Titlebar } from "./components/ui/Titlebar";
import { TooltipProvider } from "./components/ui/Tooltip";

export type AppView = "chat" | "library" | "connectors";

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<AppView>("chat");

  return (
    <div className="AppShell">
      <Titlebar
        title="Orch"
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <div className="AppShell-body">
        {sidebarOpen && <Sidebar currentView={view} onViewChange={setView} />}
        <div className="Main">
          {view === "chat" && <ChatPanel />}
          {view === "library" && <LibraryView />}
          {view === "connectors" && <ConnectorsView />}
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
  const authStatus      = useAuthStore((s) => s.status);
  const user            = useAuthStore((s) => s.user);
  const justSignedIn    = useAuthStore((s) => s.justSignedIn);
  const dismissGreeting = useAuthStore((s) => s.dismissGreeting);
  const initializeAuth  = useAuthStore((s) => s.initialize);
  const initializeChat  = useChatStore((s) => s.initialize);
  const startUpdater    = useUpdaterStore((s) => s.start);

  const workspaceStatus = useWorkspaceStore((s) => s.status);
  const initWorkspace   = useWorkspaceStore((s) => s.initialize);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (authStatus === "loading") return;
    void getCurrentWindow().show();
    void startUpdater();
  }, [authStatus, startUpdater]);

  useEffect(() => {
    if (authStatus !== "signedIn") return;
    void initWorkspace();
  }, [authStatus, initWorkspace]);

  useEffect(() => {
    if (workspaceStatus !== "ready") return;
    void initializeChat();
  }, [workspaceStatus, initializeChat]);

  if (
    authStatus === "loading" ||
    (authStatus === "signedIn" && workspaceStatus === "loading")
  ) {
    return (
      <div className="AuthLoading">
        <div className="Spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (authStatus === "signedOut") return <Onboarding />;
  if (justSignedIn) return <Greeting user={user} onDone={dismissGreeting} />;

  if (workspaceStatus === "needs_pick" || workspaceStatus === "error") {
    return <WorkspacePicker />;
  }

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
