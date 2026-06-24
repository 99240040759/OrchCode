import { useEffect, useRef } from "react";
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ITheme } from '@xterm/xterm';
import { el } from '@/lib/electron';
const THEME: ITheme = {
  background: '#1a1a1a', foreground: '#cccccc',
  cursor: '#e5c07b', cursorAccent: '#1a1a1a',
  selectionBackground: '#3a3a3a80',
  black: '#1a1a1a', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#ffffff',
};
export default function TerminalPane({ convId, cwd }: { convId: string; cwd?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({ theme: THEME, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.45, cursorBlink: true, allowTransparency: true, scrollback: 5000, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    requestAnimationFrame(() => { try { fit.fit(); } catch {} });
    let active = true, unsub: (() => void) | undefined, unsubExit: (() => void) | undefined;
    (async () => {
      await el.ptyEnsure(convId, cwd);
      if (!active) return;
      const scrollback = await el.ptyAttach(convId, term.cols, term.rows);
      if (!active) { await el.ptyDetach(convId); return; }
      if (scrollback) term.write(scrollback);
      unsub = el.onPtyData(convId, (data: string) => term.write(data));
      unsubExit = el.onPtyExit(convId, () => term.write('\r\n\x1b[2m[Process exited]\x1b[0m'));
    })();
    term.onData((data: string) => el.ptyWrite(convId, data));
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { try { fit.fit(); el.ptyResize(convId, term.cols, term.rows); } catch {} }));
    ro.observe(ref.current);
    return () => { active = false; unsub?.(); unsubExit?.(); ro.disconnect(); el.ptyDetach(convId).catch(() => {}); term.dispose(); };
  }, [convId]);
  return <div ref={ref} className="w-full h-full" style={{ background: '#1a1a1a', padding: '6px 8px', boxSizing: 'border-box' }} />;
}
