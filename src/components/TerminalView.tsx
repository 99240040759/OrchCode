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

    const term = new XTerm({
      fontSize: 12,
      fontFamily: '"SF Mono", "SF Pro Mono", Menlo, Monaco, monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#141414",
        foreground: "#F0F0F0",
        cursor: "#F0F0F0",
        cursorAccent: "#141414",
        selectionBackground: "rgba(240, 240, 240, 0.12)",
        black: "#242424",
        red: "#FC6B83",
        green: "#3FA266",
        yellow: "#D2943E",
        blue: "#CCCCCC",
        magenta: "#B48EAD",
        cyan: "#AAAAAA",
        white: "#F0F0F0",
        brightBlack: "#F0F0F099",
        brightRed: "#FC6B83",
        brightGreen: "#70B489",
        brightYellow: "#F1B467",
        brightBlue: "#E0E0E0",
        brightMagenta: "#B48EAD",
        brightCyan: "#D4D4D4",
        brightWhite: "#FFFFFF",
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
