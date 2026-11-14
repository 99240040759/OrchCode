import type { ReactNode } from "react";
import { TrafficSpacer, WindowControls } from "../ui/WindowControls";

export function Screen({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="screen">
      <div className="bar" data-tauri-drag-region>
        <TrafficSpacer />
        <div className="bar-fill" data-tauri-drag-region />
        <WindowControls />
      </div>
      <main className="screen-body">
        <img src="/icon.png" alt="" className="screen-logo" />
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <div className="screen-actions">{children}</div>
      </main>
    </div>
  );
}
