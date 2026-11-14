import { useEffect, useRef } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { Workspace } from "./Workspace";
import { useShell } from "./shellStore";

const SIDEBAR_PX = 260;

export function Frame() {
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const sidebarRef = usePanelRef();
  const width = useRef(SIDEBAR_PX);
  const initiallyOpen = useRef(sidebarOpen).current;

  useEffect(() => {
    const panel = sidebarRef.current;
    if (!panel || sidebarOpen !== panel.isCollapsed()) return;
    if (sidebarOpen) panel.resize(width.current);
    else panel.collapse();
  }, [sidebarOpen, sidebarRef]);

  return (
    <Group orientation="horizontal">
      <Panel
        id="sidebar"
        panelRef={sidebarRef}
        className="pane pane-end"
        style={{ overflow: "hidden" }}
        defaultSize={initiallyOpen ? SIDEBAR_PX : 0}
        minSize={200}
        maxSize={420}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={({ inPixels }) => {
          if (inPixels > 0) width.current = inPixels;
          const open = inPixels > 0;
          if (open !== useShell.getState().sidebarOpen) useShell.getState().setSidebarOpen(open);
        }}
      >
        <Sidebar />
      </Panel>
      <Separator className="gutter" />
      <Panel id="main" className="pane" style={{ overflow: "hidden" }} minSize={420}>
        <Workspace />
      </Panel>
    </Group>
  );
}
