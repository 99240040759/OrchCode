import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { reportError } from "./lib/api";
import "./global.css";

if (import.meta.env.PROD) {
  window.addEventListener("error", (event) => {
    const msg = event.error?.stack || event.message || "Unknown error";
    void reportError(msg).catch(() => {});
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    void reportError(`Unhandled rejection: ${msg}`).catch(() => {});
  });
}

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => {
  const node = e.target as Node | null;
  const el = (node instanceof Element ? node : node?.parentElement) as HTMLElement | null;
  if (!el?.closest("input, textarea, [contenteditable='true'], [contenteditable=''], .Composer-input, .Msg, .Markdown, .CodeViewer, .CodeBlock, .ToolRow, .ToolRow-output, .Reasoning-body, .XlsxViewer-table, .DocViewer-render")) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

