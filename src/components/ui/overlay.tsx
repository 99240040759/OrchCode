import { useEffect } from "react";
import { create } from "zustand";

export const useOverlayStore = create<{ count: number; change: (delta: number) => void }>((set) => ({
  count: 0,
  change: (delta) => set((s) => ({ count: Math.max(0, s.count + delta) })),
}));

export function OverlayPresence() {
  const change = useOverlayStore((s) => s.change);
  useEffect(() => {
    change(1);
    return () => change(-1);
  }, [change]);
  return null;
}
