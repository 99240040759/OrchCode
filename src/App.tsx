import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { reportError } from "./lib/api";
import { useAuthStore } from "./lib/auth";
import { useChatStore } from "./lib/store";
import { useUpdaterStore } from "./lib/updater";
import { useWorkspaceStore } from "./lib/workspace";
import { Button } from "./components/ui/Button";
import { TooltipProvider } from "./components/ui/Tooltip";
import { RepoDialog } from "./components/projects/RepoDialog";
import { Sidebar } from "./components/shell/Sidebar";
import { Workspace } from "./components/shell/Workspace";
import { useShell } from "./components/shell/shellStore";
import { ProjectPicker } from "./components/screens/ProjectPicker";
import { SignIn } from "./components/screens/SignIn";

function Shell() {
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <div className="side-slot">
        <Sidebar />
      </div>
      <Workspace />
      <RepoDialog />
    </div>
  );
}

function Loading() {
  return (
    <div className="center" data-tauri-drag-region>
      <span className="spinner" data-size="lg" role="status" aria-label="Loading" />
    </div>
  );
}

function Fatal({ error, resetErrorBoundary }: FallbackProps) {
  const err = error instanceof Error ? error : new Error(String(error));
  useEffect(() => {
    void getCurrentWindow().show();
    if (import.meta.env.PROD) void reportError(err.stack || err.message).catch(() => {});
  }, [err]);

  return (
    <div className="center">
      <div className="fatal" role="alert">
        <h2>Something went wrong</h2>
        <p>{err.message}</p>
        <Button variant="subtle" onClick={resetErrorBoundary}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function Root() {
  const authStatus = useAuthStore((s) => s.status);
  const initializeAuth = useAuthStore((s) => s.initialize);
  const initializeChat = useChatStore((s) => s.initialize);
  const startUpdater = useUpdaterStore((s) => s.start);
  const workspaceStatus = useWorkspaceStore((s) => s.status);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.show().then(() => win.setFocus());
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (authStatus !== "loading" && import.meta.env.PROD) void startUpdater();
  }, [authStatus, startUpdater]);

  useEffect(() => {
    if (workspaceStatus === "ready") void initializeChat();
  }, [workspaceStatus, initializeChat]);

  if (authStatus === "loading") return <Loading />;
  if (authStatus === "signedOut") return <SignIn />;
  if (workspaceStatus === "loading" || workspaceStatus === "idle") return <Loading />;
  if (workspaceStatus === "needs_pick" || workspaceStatus === "error") return <ProjectPicker />;
  return <Shell />;
}

export default function App() {
  return (
    <ErrorBoundary FallbackComponent={Fatal}>
      <TooltipProvider delayDuration={400} skipDelayDuration={150} disableHoverableContent>
        <Root />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
