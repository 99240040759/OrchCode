import { useMemo } from "react";
import { LuPlug } from "react-icons/lu";
import { selectActiveConnectors, useChatStore } from "../../lib/store";
import { GITHUB_ID, useConnectorsStore } from "../../lib/connectors";
import { ConnectorIcon } from "../common/ConnectorIcon";
import { MenuCheckboxItem, MenuItem, MenuSub, MenuSubContent, MenuSubTrigger } from "../ui/Menu";

export function ConnectorsMenu() {
  const connectors = useConnectorsStore((s) => s.connectors);
  const loaded = useConnectorsStore((s) => s.loaded);
  const loadFailed = useConnectorsStore((s) => s.loadFailed);
  const active = useChatStore(selectActiveConnectors);
  const toggle = useChatStore((s) => s.toggleConnector);
  const available = useMemo(() => connectors.filter((c) => c.connected && c.id !== GITHUB_ID), [connectors]);
  const empty = loadFailed ? "Couldn't load connectors" : loaded ? "No connected apps" : "Loading…";

  return (
    <MenuSub>
      <MenuSubTrigger meta={active.length > 0 ? <span className="badge">{active.length}</span> : undefined}>
        <LuPlug />
        <span className="row-label">Connectors</span>
      </MenuSubTrigger>
      <MenuSubContent>
        {available.length === 0 ? (
          <MenuItem disabled>{empty}</MenuItem>
        ) : (
          available.map((c) => (
            <MenuCheckboxItem
              key={c.id}
              checked={active.includes(c.id)}
              onCheckedChange={() => toggle(c.id)}
              onSelect={(e) => e.preventDefault()}
            >
              <ConnectorIcon id={c.id} />
              <span className="row-label">{c.name}</span>
            </MenuCheckboxItem>
          ))
        )}
      </MenuSubContent>
    </MenuSub>
  );
}
