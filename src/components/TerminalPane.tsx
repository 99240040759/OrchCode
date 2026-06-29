import { useEffect, useRef } from "react";
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ITheme } from '@xterm/xterm';
import { el } from '@/lib/electron';

export default function TerminalPane({ convId, cwd }: { convId: string; cwd?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const style = getComputedStyle(ref.current || document.body);
    const getVar = (name: string) => style.getPropertyValue(name).trim() || undefined;
    const theme: ITheme = {
      background: 'transparent',
      foreground: getVar('--color-foreground'),
      cursor: getVar('--color-primary'),
      cursorAccent: getVar('--color-background'),
      selectionBackground: 'rgba(208, 122, 82, 0.28)',
      black: getVar('--color-background'),
      red: getVar('--color-destructive'),
      yellow: getVar('--color-primary'),
      white: getVar('--color-foreground'),
      brightBlack: getVar('--color-muted-foreground'),
      brightRed: getVar('--color-destructive'),
      brightYellow: getVar('--color-primary'),
      brightWhite: getVar('--color-foreground'),
      green: getVar('--color-term-green'), 
      blue: getVar('--color-term-blue'), 
      magenta: getVar('--color-term-magenta'), 
      cyan: getVar('--color-term-cyan'),
      brightGreen: getVar('--color-term-green'), 
      brightBlue: getVar('--color-term-blue'), 
      brightMagenta: getVar('--color-term-magenta'), 
      brightCyan: getVar('--color-term-cyan'),
    };
    const term = new Terminal({ 
      theme, 
      lineHeight: 1.45, 
      cursorBlink: true, 
      allowTransparency: true, 
      scrollback: 5000, 
      convertEol: true,
      fontFamily: getVar('--font-mono') || 'monospace',
      fontSize: 13
    });
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
  }, [convId, cwd]);
  return <div ref={ref} className="w-full h-full bg-background p-4 box-border overflow-hidden" />;
}
