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
    const fg = styles.getPropertyValue("--md-on").trim() || "#ececec";
    const monoFont =
      styles.getPropertyValue("--font-mono").trim() ||
      '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace';

    const term = new XTerm({
      fontSize: 12,
      fontFamily: monoFont,
      cursorBlink: false,
      scrollback: 5000,
      theme: {
        background: bg,
        foreground: fg,
        cursor: fg,
        cursorAccent: bg,
        selectionBackground: "rgba(255, 255, 255, 0.16)",
        black: "#1a1a1a",
        red: "#fc6b83",
        green: "#70b489",
        yellow: "#f1b467",
        blue: "#c8c8c8",
        magenta: "#b48ead",
        cyan: "#a0a0a0",
        white: "#ececec",
        brightBlack: "#787878",
        brightRed: "#fc6b83",
        brightGreen: "#70b489",
        brightYellow: "#f1b467",
        brightBlue: "#ececec",
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
        if (!disposed) {
          term.write(`\r\n\x1b[31m${api.errorMessage(e)}\x1b[0m\r\n`);
        }
      });

    const dataSubscription = term.onData((data) => {
      if (disposed) return;
      void api.terminalWrite(sessionId, data).catch(() => undefined);
    });

    let prevCols = term.cols;
    let prevRows = term.rows;
    let resizeRaf = 0;

    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (disposed || !safeFit()) return;
        if (term.cols !== prevCols || term.rows !== prevRows) {
          prevCols = term.cols;
          prevRows = term.rows;
          void api.terminalResize(sessionId, term.cols, term.rows).catch(() => undefined);
        }
      });
    });
    observer.observe(container);

    return () => {
      disposed = true;
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      dataSubscription.dispose();
      observer.disconnect();
      if (opened) void api.terminalClose(sessionId).catch(() => undefined);
      term.dispose();
    };
  }, [id]);

  return <div className="TerminalView" ref={containerRef} />;
}
