import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import * as api from "../lib/api";

export function TerminalView({ id, cwd }: { id: string; cwd?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const generation = ++generationRef.current;

    const term = new XTerm({
      fontSize: 12,
      fontFamily: '"SF Mono", "SF Pro Mono", Menlo, Monaco, monospace',
      cursorBlink: true,
      theme: { background: "#1a1a1a", foreground: "#e0e0e0", cursor: "#bb86fc", selectionBackground: "rgba(187,134,252,0.3)" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
    } catch {}

    let opened = false;

    api
      .terminalOpen(id, cwd ?? null, term.cols, term.rows, (e) => {
        if (generationRef.current !== generation) return;
        if (e.type === "data") term.write(e.data);
        else if (e.type === "exit") term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      })
      .then(() => { opened = true; })
      .catch((err) => term.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`));

    const onData = term.onData((data) => { void api.terminalWrite(id, data); });

    const ro = new ResizeObserver(() => {
      if (generationRef.current !== generation) return;
      try {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          fit.fit();
          void api.terminalResize(id, term.cols, term.rows);
        }
      } catch {}
    });
    ro.observe(container);

    return () => {
      generationRef.current = generation + 1;
      onData.dispose();
      ro.disconnect();
      if (opened) void api.terminalClose(id);
      term.dispose();
    };
  }, [id, cwd]);

  return <div className="TerminalView" ref={ref} />;
}
