import { useEffect } from "react";
import { Avatar } from "./Avatar";
import { Titlebar } from "./ui/Titlebar";
import type { UserDisplay } from "../lib/api";

export function Greeting({ user, onDone }: { user: UserDisplay | null; onDone: () => void }) {
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, prefersReduced ? 0 : 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  const firstName = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <div
      className="Greeting"
      role="dialog"
      aria-label={`Welcome, ${firstName}`}
      onClick={onDone}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onDone(); }}
      tabIndex={0}
    >
      <Titlebar className="Greeting-titlebar" />
      <div className="Greeting-content">
        <Avatar src={user?.avatarUrl} fallback={user?.initial ?? "?"} />
        <h1 className="Greeting-title">Welcome, {firstName}</h1>
        <p className="Greeting-sub">Let&apos;s build something great.</p>
      </div>
    </div>
  );
}
