import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { useArtifactsStore } from "../../lib/artifacts";
import { ChatView } from "../chat/ChatView";
import { ArtifactPanel } from "../panel/ArtifactPanel";
import { fileWritten } from "../panel/actions";
import { Integrations } from "../screens/Integrations";
import { MainBar } from "./Bars";
import { useShell } from "./shellStore";

const MIN_CHAT_PX = 360;
const MIN_PANEL_PX = 340;

function useFileWrittenEvents() {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ path?: string }>("file-written", (event) => {
      if (event.payload?.path) fileWritten(event.payload.path);
    }).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

function useResizer(mainRef: RefObject<HTMLDivElement | null>) {
  const [ratio, setRatio] = useState(0.5);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const main = mainRef.current;
    if (!main || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "";
    main.dataset.resizing = "";
    const rect = main.getBoundingClientRect();
    let next = ratio;

    const move = (e: globalThis.PointerEvent) => {
      const panelPx = Math.min(rect.width - MIN_CHAT_PX, Math.max(MIN_PANEL_PX, rect.right - e.clientX));
      next = panelPx / rect.width;
      main.style.setProperty("--panel-ratio", String(next));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      delete handle.dataset.dragging;
      delete main.dataset.resizing;
      setRatio(next);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return { ratio, onPointerDown };
}

export function Workspace() {
  const view = useShell((s) => s.view);
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const maximized = useArtifactsStore((s) => s.maximized);
  const panelShown = view === "chat" && panelOpen;
  const mainRef = useRef<HTMLDivElement>(null);
  const { ratio, onPointerDown } = useResizer(mainRef);
  useFileWrittenEvents();

  return (
    <div
      ref={mainRef}
      className="main"
      data-maximized={(panelShown && maximized) || undefined}
      style={{ "--panel-ratio": ratio } as CSSProperties}
    >
      <section className="col col-chat">
        <MainBar panelShown={panelShown} />
        <div className="stage">
          <div className="view" hidden={view !== "chat"}>
            <ChatView />
          </div>
          {view === "integrations" && (
            <div className="view">
              <Integrations />
            </div>
          )}
        </div>
      </section>
      <div className="resizer" hidden={!panelShown || maximized} onPointerDown={onPointerDown} role="separator" aria-orientation="vertical" />
      <section className="col col-panel" hidden={!panelShown}>
        <ArtifactPanel visible={panelShown} />
      </section>
    </div>
  );
}
