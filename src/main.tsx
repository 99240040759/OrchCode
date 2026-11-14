import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import { reportError } from "./lib/api";
import "./global.css";

if (import.meta.env.PROD) {
  window.addEventListener("error", (event) => {
    void reportError(event.error?.stack || event.message || "Unknown error").catch(() => {});
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    void reportError(`Unhandled rejection: ${message}`).catch(() => {});
  });
}

const SELECTABLE = "input, textarea, [contenteditable], .selectable";

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => {
  const node = e.target as Node | null;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest(SELECTABLE)) e.preventDefault();
});
document.addEventListener("mousedown", (e) => {
  if (e.button === 1 && (e.target as Element).closest("a")) e.preventDefault();
});
document.addEventListener("dragstart", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "IMG" || tag === "A") e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
