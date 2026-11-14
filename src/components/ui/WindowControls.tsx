import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VscChromeClose, VscChromeMaximize, VscChromeMinimize, VscChromeRestore } from "react-icons/vsc";
import { IS_MAC } from "../../lib/utils";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (IS_MAC) return;
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => void win.isMaximized().then((value) => !disposed && setMaximized(value));
    sync();
    void win.onResized(sync).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (IS_MAC) return null;
  const win = getCurrentWindow();

  return (
    <div className="winctl">
      <button type="button" aria-label="Minimize" onClick={() => void win.minimize()}>
        <VscChromeMinimize />
      </button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
        {maximized ? <VscChromeRestore /> : <VscChromeMaximize />}
      </button>
      <button type="button" data-close aria-label="Close" onClick={() => void win.close()}>
        <VscChromeClose />
      </button>
    </div>
  );
}

export function TrafficSpacer() {
  return IS_MAC ? <div className="traffic" data-tauri-drag-region /> : null;
}
