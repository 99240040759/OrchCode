import { flushSync } from "react-dom";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function transition(update: () => void) {
  if (typeof document.startViewTransition !== "function" || reducedMotion.matches || document.hidden) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
