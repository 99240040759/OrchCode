import { useCallback, useEffect, useRef, useState } from "react";
import { VscArrowLeft, VscArrowRight, VscLinkExternal, VscRefresh } from "react-icons/vsc";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { DEFAULT_BROWSER_URL } from "../lib/artifacts";
import { newId } from "../lib/api";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

const OFFSCREEN = -100000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserView({
  initialUrl,
  active = true,
}: {
  initialUrl?: string;
  active?: boolean;
}) {
  const [label, setLabel] = useState("");
  const startUrl = normalizeUrl(initialUrl ?? DEFAULT_BROWSER_URL);

  const [input, setInput] = useState(startUrl);
  const [committedUrl, setCommittedUrl] = useState(startUrl);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const initialUrlRef = useRef(startUrl);
  const lastPropUrl = useRef(startUrl);
  const activeRef = useRef(active);
  activeRef.current = active;
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const currentLabel = `browser-${newId()}`;
    setLabel(currentLabel);

    let disposed = false;
    let visible = true;
    const appWindow = getCurrentWindow();

    const webview = new Webview(appWindow, currentLabel, {
      url: initialUrlRef.current,
      x: OFFSCREEN,
      y: OFFSCREEN,
      width: 1,
      height: 1,
    });

    void webview.once("tauri://created", () => {
      if (disposed) {
        void webview.setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)).catch(() => {});
        void webview.setSize(new LogicalSize(0, 0)).catch(() => {});
        void webview.close().catch(() => {});
        void api.webviewClose(currentLabel).catch(() => {});
        return;
      }
      setReady(true);
      syncPosition();
    });
    void webview.once("tauri://error", (event) => {
      if (!disposed) setError(String(event.payload));
    });

    const syncPosition = () => {
      if (disposed) return;
      if (!activeRef.current) {
        void webview.setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)).catch(() => {});
        void webview.setSize(new LogicalSize(0, 0)).catch(() => {});
        return;
      }
      const bounds = host.getBoundingClientRect();
      const isValid =
        visible &&
        bounds.width > 20 &&
        bounds.height > 20 &&
        bounds.top >= 0 &&
        bounds.left >= 0;

      if (isValid) {
        void webview
          .setPosition(new LogicalPosition(Math.round(bounds.left), Math.round(bounds.top)))
          .catch(() => {});
        void webview
          .setSize(new LogicalSize(Math.round(bounds.width), Math.round(bounds.height)))
          .catch(() => {});
      } else {
        void webview.setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)).catch(() => {});
        void webview.setSize(new LogicalSize(0, 0)).catch(() => {});
      }
    };

    syncRef.current = syncPosition;

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        visible = entries[entries.length - 1].intersectionRatio > 0;
        syncPosition();
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(host);

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(host);
    if (host.parentElement) resizeObserver.observe(host.parentElement);

    window.addEventListener("resize", syncPosition);
    syncPosition();

    return () => {
      disposed = true;
      setReady(false);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncPosition);
      void webview.setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)).catch(() => {});
      void webview.setSize(new LogicalSize(0, 0)).catch(() => {});
      void webview.close().catch(() => {});
      void api.webviewClose(currentLabel).catch(() => {});
    };
  }, []);

  useEffect(() => {
    syncRef.current?.();
  }, [active]);

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
    if (!ready || !label) return;
    api.webviewNavigate(label, committedUrl).catch((e) => setError(api.errorMessage(e)));
  }, [committedUrl, ready, label]);

  const runHistory = (action: api.HistoryAction) => {
    if (!ready) return;
    api.webviewHistory(label, action).catch((e) => setError(api.errorMessage(e)));
  };

  return (
    <div className="BrowserView">
      <div className="BrowserBar">
        <Tooltip content="Back" side="bottom">
          <Button className="IconBtn" aria-label="Back" onClick={() => runHistory("back")} disabled={!ready}>
            <VscArrowLeft />
          </Button>
        </Tooltip>
        <Tooltip content="Forward" side="bottom">
          <Button
            className="IconBtn"
            aria-label="Forward"
            onClick={() => runHistory("forward")}
            disabled={!ready}
          >
            <VscArrowRight />
          </Button>
        </Tooltip>
        <Tooltip content="Reload" side="bottom">
          <Button
            className="IconBtn"
            aria-label="Reload"
            onClick={() => runHistory("reload")}
            disabled={!ready}
          >
            <VscRefresh />
          </Button>
        </Tooltip>
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
        <Tooltip content="Open in browser" side="bottom">
          <Button
            className="IconBtn"
            aria-label="Open in system browser"
            onClick={() => void openUrl(normalizeUrl(input))}
          >
            <VscLinkExternal />
          </Button>
        </Tooltip>
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
