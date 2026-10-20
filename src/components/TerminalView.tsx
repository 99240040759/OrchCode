import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import * as api from "../lib/api";

export function TerminalView({ id }: { id: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sessionId = `${id}:${api.newId()}`;
    let disposed = false;

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--md-bg").trim() || "#0f0f0f";
    const fg = styles.getPropertyValue("--md-on").trim() || "#e8e8e8";

    const term = new XTerm({
      fontSize: 12,
      fontFamily: '"SF Mono", "SF Pro Mono", Menlo, Monaco, monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: bg,
        foreground: fg,
        cursor: fg,
        cursorAccent: bg,
        selectionBackground: "rgba(255, 255, 255, 0.14)",
        black: "#1a1a1a",
        red: "#fc6b83",
        green: "#70b489",
        yellow: "#f1b467",
        blue: "#c8c8c8",
        magenta: "#b48ead",
        cyan: "#a0a0a0",
        white: "#e8e8e8",
        brightBlack: "rgba(232, 232, 232, 0.4)",
        brightRed: "#fc6b83",
        brightGreen: "#70b489",
        brightYellow: "#f1b467",
        brightBlue: "#e8e8e8",
        brightMagenta: "#b48ead",
        brightCyan: "#d4d4d4",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const safeFit = () => {
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
      fit.fit();
      return true;
    };
    safeFit();

    let opened = false;
    api
      .terminalOpen(sessionId, term.cols, term.rows, (event) => {
        if (disposed) return;
        if (event.type === "data") term.write(event.data);
        else term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      })
      .then(() => {
        opened = true;
        if (disposed) {
          void api.terminalClose(sessionId).catch(() => undefined);
        }
      })
      .catch((e) => {
        term.write(`\r\n\x1b[31m${api.errorMessage(e)}\x1b[0m\r\n`);
      });

    const dataSubscription = term.onData((data) => {
      void api.terminalWrite(sessionId, data).catch(() => undefined);
    });

    const observer = new ResizeObserver(() => {
      if (disposed || !safeFit()) return;
      void api.terminalResize(sessionId, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(container);

    return () => {
      disposed = true;
      dataSubscription.dispose();
      observer.disconnect();
      if (opened) void api.terminalClose(sessionId).catch(() => undefined);
      window.setTimeout(() => term.dispose(), 0);
    };
  }, [id]);

  return <div className="TerminalView" ref={containerRef} />;
}
