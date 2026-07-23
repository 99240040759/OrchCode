import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiRotateCw, FiExternalLink } from "react-icons/fi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { Button } from "./ui/Button";

function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return "about:blank";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(t)) return `http://${t}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

const OFFSCREEN = -100000;

export function BrowserView({ id, initialUrl }: { id: string; initialUrl?: string }) {
  const start = normalizeUrl(initialUrl ?? "https://www.google.com");
  const [input, setInput] = useState(start);
  const [committedUrl, setCommittedUrl] = useState(start);
  const [webviewReady, setWebviewReady] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const label = `browser-${id}`;
  const native = api.inTauri();

  const lastPropUrl = useRef(start);

  const navigate = useCallback((next: string) => {
    setInput(next);
    setCommittedUrl(next);
  }, []);

  const go = useCallback(() => navigate(normalizeUrl(input)), [navigate, input]);

  const back = () => { if (native && webviewReady) void api.webviewBack(label); };
  const forward = () => { if (native && webviewReady) void api.webviewForward(label); };
  const reload = () => { if (native && webviewReady) void api.webviewReload(label); };

  const handleOpenExternal = () => {
    const target = normalizeUrl(input);
    if (native) void openUrl(target);
    else window.open(target, "_blank");
  };

  useEffect(() => {
    if (!native) return;
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let webview: Webview | null = null;

    const rect0 = host.getBoundingClientRect();
    const appWindow = getCurrentWindow();

    webview = new Webview(appWindow, label, {
      url: startRef.current,
      x: Math.round(rect0.left),
      y: Math.round(rect0.top),
      width: Math.max(1, Math.round(rect0.width)),
      height: Math.max(1, Math.round(rect0.height)),
    });

    webview.once("tauri://created", () => {
      if (!disposed) setWebviewReady(true);
    });
    webview.once("tauri://error", () => {});

    const syncPosition = () => {
      if (disposed || !webview || !host) return;
      const r = host.getBoundingClientRect();
      const visible = host.offsetParent !== null && r.width > 1 && r.height > 1;
      const x = visible ? Math.round(r.left) : OFFSCREEN;
      const y = visible ? Math.round(r.top) : OFFSCREEN;
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      void webview.setPosition(new LogicalPosition(x, y));
      if (visible) void webview.setSize(new LogicalSize(w, h));
    };

    syncPosition();

    const observer = new ResizeObserver(syncPosition);
    observer.observe(host);

    const mutationObserver = new MutationObserver(syncPosition);
    mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: false });

    return () => {
      disposed = true;
      setWebviewReady(false);
      observer.disconnect();
      mutationObserver.disconnect();
      if (webview) void webview.close();
    };
  }, [label, native]);

  useEffect(() => {
    const next = normalizeUrl(initialUrl ?? "https://www.google.com");
    if (next === lastPropUrl.current) return;
    lastPropUrl.current = next;
    navigate(next);
  }, [initialUrl, navigate]);

  useEffect(() => {
    if (native && webviewReady) void api.webviewNavigate(label, committedUrl);
  }, [committedUrl, native, webviewReady, label]);

  return (
    <div className="BrowserView">
      <div className="BrowserBar">
        <Button className="IconBtn" aria-label="Back" onClick={back} disabled={!webviewReady}>
          <FiArrowLeft />
        </Button>
        <Button className="IconBtn" aria-label="Forward" onClick={forward} disabled={!webviewReady}>
          <FiArrowRight />
        </Button>
        <Button className="IconBtn" aria-label="Reload" onClick={reload} disabled={!webviewReady}>
          <FiRotateCw />
        </Button>
        <input
          className="BrowserBar-url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder="Search or enter address"
          spellCheck={false}
          aria-label="Address bar"
        />
        <Button className="IconBtn" aria-label="Open in system browser" title="Open in external browser" onClick={handleOpenExternal}>
          <FiExternalLink />
        </Button>
      </div>
      {native ? (
        <div className="BrowserHost" ref={hostRef} />
      ) : (
        <iframe
          className="BrowserFrame"
          style={{ colorScheme: "dark", background: "var(--md-bg)" }}
          src={committedUrl}
          title="Browser"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
