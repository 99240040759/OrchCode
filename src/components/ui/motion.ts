import { useCallback, useEffect, useRef } from "react";

const MOTION_MS = 320;

export function usePanelMotion() {
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const animate = useCallback((change: () => void) => {
    const el = ref.current;
    if (el) {
      el.dataset.moving = "";
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => delete el.dataset.moving, MOTION_MS);
    }
    change();
  }, []);

  return [ref, animate] as const;
}
