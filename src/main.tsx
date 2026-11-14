import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Menu, PredefinedMenuItem } from "@tauri-apps/api/menu";
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

const EDITABLE = "input, textarea, [contenteditable]";
const SELECTABLE = `${EDITABLE}, .selectable`;

type Item = "Undo" | "Redo" | "Cut" | "Copy" | "Paste" | "SelectAll" | "Separator";

const menus = new Map<string, Promise<Menu>>();

function nativeMenu(kind: "edit" | "read"): Promise<Menu> {
  let menu = menus.get(kind);
  if (!menu) {
    const items: Item[] =
      kind === "edit"
        ? ["Undo", "Redo", "Separator", "Cut", "Copy", "Paste", "Separator", "SelectAll"]
        : ["Copy", "Separator", "SelectAll"];
    menu = Promise.all(items.map((item) => PredefinedMenuItem.new({ item }))).then((built) =>
      Menu.new({ items: built })
    );
    menus.set(kind, menu);
  }
  return menu;
}

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest(EDITABLE)) void nativeMenu("edit").then((m) => m.popup());
  else if (el?.closest(".selectable") && window.getSelection()?.toString()) void nativeMenu("read").then((m) => m.popup());
});

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
