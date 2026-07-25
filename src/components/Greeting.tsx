import { useEffect } from "react";
import { Avatar } from "./Avatar";
import { Titlebar } from "./ui/Titlebar";
import type { UserDisplay } from "../lib/api";

const GREETING_MS = 2600;

export function Greeting({
  user,
  onDone,
}: {
  user: UserDisplay | null;
  onDone: () => void;
}) {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(onDone, reduced ? 0 : GREETING_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const firstName = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <div
      className="Greeting"
      role="button"
      tabIndex={0}
      aria-label="Continue to the workspace"
      onClick={onDone}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Escape") onDone();
      }}
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

export default Greeting;
