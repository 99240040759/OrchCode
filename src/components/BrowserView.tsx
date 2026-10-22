import { useCallback, useEffect, useRef, useState } from "react";
import {
  VscArrowLeft,
  VscArrowRight,
  VscLinkExternal,
  VscRefresh,
  VscClose,
} from "react-icons/vsc";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { DEFAULT_BROWSER_URL } from "../lib/artifacts";
import { newId } from "../lib/api";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { useOverlayStore } from "./ui/DropdownMenu";

const OFFSCREEN = -100000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserView({ initialUrl }: { initialUrl?: string }) {
  const [label, setLabel] = useState("");
  const startUrl = normalizeUrl(initialUrl ?? DEFAULT_BROWSER_URL);

  const [input, setInput] = useState(startUrl);
  const [committedUrl, setCommittedUrl] = useState(startUrl);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayOpen = useOverlayStore((s) => s.count > 0);
  const overlayRef = useRef(overlayOpen);
  const syncRef = useRef<() => void>(() => {});
  const initialUrlRef = useRef(startUrl);
  const initialLoadedRef = useRef(false);
  const lastPropUrl = useRef(startUrl);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        void webview.close().catch(() => api.webviewClose(currentLabel).catch(() => {}));
        return;
      }
      setReady(true);
      setLoading(false);
      syncPosition();
    });
    void webview.once("tauri://error", (event) => {
      if (!disposed) setError(String(event.payload));
    });

    const syncPosition = () => {
      if (disposed) return;
      const bounds = host.getBoundingClientRect();
      const isValid =
        visible &&
        !overlayRef.current &&
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
    syncRef.current = syncPosition;
    syncPosition();

    return () => {
      disposed = true;
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      setReady(false);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncPosition);
      void webview.setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)).catch(() => {});
      void webview.setSize(new LogicalSize(0, 0)).catch(() => {});
      void webview.close().catch(() => api.webviewClose(currentLabel).catch(() => {}));
    };
  }, []);

  useEffect(() => {
    overlayRef.current = overlayOpen;
    syncRef.current();
  }, [overlayOpen]);

  const navigate = useCallback((next: string) => {
    setInput(next);
    setCommittedUrl(next);
    setError(null);
    setLoading(true);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => setLoading(false), 3000);
  }, []);

  useEffect(() => {
    const next = normalizeUrl(initialUrl ?? DEFAULT_BROWSER_URL);
    if (next === lastPropUrl.current) return;
    lastPropUrl.current = next;
    navigate(next);
  }, [initialUrl, navigate]);

  useEffect(() => {
    if (!ready || !label) return;
    if (!initialLoadedRef.current) {
      initialLoadedRef.current = true;
      return;
    }
    api.webviewNavigate(label, committedUrl).catch((e) => {
      setError(api.errorMessage(e));
      setLoading(false);
    });
  }, [committedUrl, ready, label]);

  const runHistory = (action: api.HistoryAction) => {
    if (!ready) return;
    setLoading(true);
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => setLoading(false), 3000);
    api.webviewHistory(label, action).catch((e) => {
      setError(api.errorMessage(e));
      setLoading(false);
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      navigate(normalizeUrl(input));
      inputRef.current?.blur();
    }
    if (e.key === "Escape") {
      setInput(committedUrl);
      inputRef.current?.blur();
    }
  };

  const handleInputFocus = () => {
    setInputFocused(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  return (
    <div className="BrowserView">
      <div className="BrowserBar">
        <div className="BrowserBar-navGroup">
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
          <Tooltip content={loading ? "Stop loading" : "Reload"} side="bottom">
            <Button
              className="IconBtn"
              aria-label={loading ? "Stop loading" : "Reload"}
              onClick={() => {
                if (loading) {
                  if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
                  setLoading(false);
                  if (ready && label) {
                    void api.webviewHistory(label, "stop").catch(() => {});
                  }
                } else {
                  runHistory("reload");
                }
              }}
              disabled={!ready}
            >
              {loading ? <VscClose /> : <VscRefresh className={loading ? "BrowserBar-spin" : ""} />}
            </Button>
          </Tooltip>
        </div>

        <div className={`BrowserBar-urlWrap${inputFocused ? " focused" : ""}`}>
          {!inputFocused && (
            <span className="BrowserBar-favicon" aria-hidden="true">
              🌐
            </span>
          )}
          {loading && !inputFocused && (
            <span className="BrowserBar-loadBar" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            className="BrowserBar-url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={handleInputFocus}
            onBlur={() => setInputFocused(false)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search or enter address"
            aria-label="Address bar"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
        </div>

        <Tooltip content="Open in system browser" side="bottom">
          <Button
            className="IconBtn"
            aria-label="Open in system browser"
            onClick={() => void openUrl(normalizeUrl(input))}
          >
            <VscLinkExternal />
          </Button>
        </Tooltip>
      </div>

      {loading && <div className="BrowserBar-progress" aria-hidden="true" />}

      {error && (
        <div className="BrowserView-error" role="alert">
          {error}
        </div>
      )}
      <div className="BrowserHost" ref={hostRef} />
    </div>
  );
}
