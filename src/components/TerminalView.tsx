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

    // All terminal styling comes from the design tokens in global.css.
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    const ink = token("--brand-ink");
    const raised = token("--brand-raised");
    const cream = token("--brand-cream");
    const stone = token("--brand-stone");
    const accent = token("--brand-accent");
    const amber = token("--brand-amber");

    const term = new XTerm({
      fontSize: parseInt(token("--fs-md"), 10),
      fontFamily: token("--font-mono"),
      lineHeight: 1.2,
      cursorBlink: false,
      scrollback: 5000,
      theme: {
        background: ink,
        foreground: cream,
        cursor: cream,
        cursorAccent: ink,
        selectionBackground: token("--accent-a3"),
        black: raised,
        red: accent,
        green: cream,
        yellow: amber,
        blue: stone,
        magenta: accent,
        cyan: stone,
        white: cream,
        brightBlack: stone,
        brightRed: accent,
        brightGreen: cream,
        brightYellow: amber,
        brightBlue: cream,
        brightMagenta: amber,
        brightCyan: cream,
        brightWhite: cream,
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
