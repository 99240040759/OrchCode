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

    let disposed = false;

    const term = new XTerm({
      fontSize: 12,
      fontFamily: '"SF Mono", "SF Pro Mono", Menlo, Monaco, monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#bb86fc",
        selectionBackground: "rgba(187,134,252,0.3)",
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
      .terminalOpen(id, term.cols, term.rows, (event) => {
        if (disposed) return;
        if (event.type === "data") term.write(event.data);
        else term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      })
      .then(() => {
        opened = true;
      })
      .catch((e) => {
        term.write(`\r\n\x1b[31m${api.errorMessage(e)}\x1b[0m\r\n`);
      });

    const dataSubscription = term.onData((data) => {
      void api.terminalWrite(id, data).catch(() => undefined);
    });

    const observer = new ResizeObserver(() => {
      if (disposed || !safeFit()) return;
      void api.terminalResize(id, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(container);

    return () => {
      disposed = true;
      dataSubscription.dispose();
      observer.disconnect();
      if (opened) void api.terminalClose(id).catch(() => undefined);
      term.dispose();
    };
  }, [id]);

  return <div className="TerminalView" ref={containerRef} />;
}

export default TerminalView;
