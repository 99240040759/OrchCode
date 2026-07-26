import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiExternalLink, FiRotateCw } from "react-icons/fi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { DEFAULT_BROWSER_URL } from "../lib/artifacts";
import { newId } from "../lib/utils";
import { Button } from "./ui/Button";

const OFFSCREEN = -100000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserView({ id: _id, initialUrl }: { id?: string; initialUrl?: string }) {
  const [label] = useState(() => `browser-${newId()}`);
  const startUrl = normalizeUrl(initialUrl ?? DEFAULT_BROWSER_URL);

  const [input, setInput] = useState(startUrl);
  const [committedUrl, setCommittedUrl] = useState(startUrl);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const initialUrlRef = useRef(startUrl);
  const lastPropUrl = useRef(startUrl);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const appWindow = getCurrentWindow();
    const rect = host.getBoundingClientRect();

    const webview = new Webview(appWindow, label, {
      url: initialUrlRef.current,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    });

    void webview.once("tauri://created", () => {
      if (!disposed) setReady(true);
    });
    void webview.once("tauri://error", (event) => {
      if (!disposed) setError(String(event.payload));
    });

    const syncPosition = () => {
      if (disposed) return;
      const bounds = host.getBoundingClientRect();
      const visible = host.offsetParent !== null && bounds.width > 1 && bounds.height > 1;
      void webview.setPosition(
        new LogicalPosition(
          visible ? Math.round(bounds.left) : OFFSCREEN,
          visible ? Math.round(bounds.top) : OFFSCREEN
        )
      );
      if (visible) {
        void webview.setSize(
          new LogicalSize(Math.round(bounds.width), Math.round(bounds.height))
        );
      }
    };

    syncPosition();

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(host);
    if (host.parentElement) resizeObserver.observe(host.parentElement);

    const mutationObserver = new MutationObserver(syncPosition);
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "class", "data-hidden"],
      subtree: true,
    });

    window.addEventListener("resize", syncPosition);

    return () => {
      disposed = true;
      setReady(false);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", syncPosition);
      void webview.close().catch(() => {});
    };
  }, [label]);

  const navigate = useCallback((next: string) => {
    setInput(next);
    setCommittedUrl(next);
  }, []);

  useEffect(() => {
    const next = normalizeUrl(initialUrl ?? DEFAULT_BROWSER_URL);
    if (next === lastPropUrl.current) return;
    lastPropUrl.current = next;
    navigate(next);
  }, [initialUrl, navigate]);

  useEffect(() => {
    if (!ready) return;
    api.webviewNavigate(label, committedUrl).catch((e) => setError(api.errorMessage(e)));
  }, [committedUrl, ready, label]);

  const runHistory = (action: api.HistoryAction) => {
    if (!ready) return;
    api.webviewHistory(label, action).catch((e) => setError(api.errorMessage(e)));
  };

  return (
    <div className="BrowserView">
      <div className="BrowserBar">
        <Button className="IconBtn" aria-label="Back" onClick={() => runHistory("back")} disabled={!ready}>
          <FiArrowLeft />
        </Button>
        <Button
          className="IconBtn"
          aria-label="Forward"
          onClick={() => runHistory("forward")}
          disabled={!ready}
        >
          <FiArrowRight />
        </Button>
        <Button
          className="IconBtn"
          aria-label="Reload"
          onClick={() => runHistory("reload")}
          disabled={!ready}
        >
          <FiRotateCw />
        </Button>
        <input
          className="BrowserBar-url"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate(normalizeUrl(input));
          }}
          placeholder="Search or enter address"
          aria-label="Address bar"
          spellCheck={false}
        />
        <Button
          className="IconBtn"
          aria-label="Open in system browser"
          onClick={() => void openUrl(normalizeUrl(input))}
        >
          <FiExternalLink />
        </Button>
      </div>
      {error && (
        <div className="BrowserView-error" role="alert">
          {error}
        </div>
      )}
      <div className="BrowserHost" ref={hostRef} />
    </div>
  );
}

export default BrowserView;
