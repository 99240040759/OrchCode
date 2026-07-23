import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "react-error-boundary";
import { useAuthStore } from "./lib/auth";
import { useChatStore } from "./lib/store";
import { Titlebar } from "./components/ui/Titlebar";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { Onboarding } from "./components/Onboarding";
import { Greeting } from "./components/Greeting";
import { inTauri } from "./lib/api";

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    useChatStore.getState().initialize();
  }, []);

  return (
    <div className="AppShell">
      <Titlebar title="Orch Code" />
      <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="AppShell-body">
        {sidebarOpen && <Sidebar onCollapse={() => setSidebarOpen(false)} />}
        <div className="Main">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}

function AppError({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="AuthLoading">
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <h2 style={{ marginBottom: 8, color: "var(--color-text)" }}>Something went wrong</h2>
        <p style={{ marginBottom: 16, color: "var(--color-text-dim)", fontSize: 13 }}>{error.message}</p>
        <button
          onClick={resetErrorBoundary}
          style={{ padding: "8px 20px", background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function Root() {
  const status = useAuthStore((s) => s.status);
  const justSignedIn = useAuthStore((s) => s.justSignedIn);
  const user = useAuthStore((s) => s.user);
  const dismissGreeting = useAuthStore((s) => s.dismissGreeting);

  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    if (inTauri() && status !== "loading") {
      requestAnimationFrame(() => {
        getCurrentWindow().show().catch(() => {});
      });
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div className="AuthLoading">
        <div className="Spinner" />
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
      <Root />
    </ErrorBoundary>
  );
}
