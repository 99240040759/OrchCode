import { useMemo } from "react";
import { LuCheck, LuChevronRight, LuPlug } from "react-icons/lu";
import { selectActiveConnectors, useChatStore } from "../../lib/store";
import { GITHUB_ID, useConnectorsStore } from "../../lib/connectors";
import { ConnectorIcon } from "../icons/ConnectorIcon";
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/DropdownMenu";

export function ConnectorsMenu() {
  const connectors = useConnectorsStore((s) => s.connectors);
  const loaded = useConnectorsStore((s) => s.loaded);
  const loadFailed = useConnectorsStore((s) => s.loadFailed);
  const active = useChatStore(selectActiveConnectors);
  const toggleConnector = useChatStore((s) => s.toggleConnector);
  const connected = useMemo(() => connectors.filter((connector) => connector.connected && connector.id !== GITHUB_ID), [connectors]);

  let emptyLabel = "No connected apps";
  if (loadFailed) emptyLabel = "Couldn't load connectors";
  else if (!loaded) emptyLabel = "Loading…";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <LuPlug />
        <span className="DropdownMenuSubTrigger-label">Connectors</span>
        {active.length > 0 && <span className="DropdownMenuSubTrigger-count">{active.length}</span>}
        <LuChevronRight className="DropdownMenuSubTrigger-chevron" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {connected.length === 0 ? (
          <DropdownMenuItem disabled>
            <span>{emptyLabel}</span>
          </DropdownMenuItem>
        ) : (
          connected.map((connector) => (
            <DropdownMenuCheckboxItem
              key={connector.id}
              checked={active.includes(connector.id)}
              onCheckedChange={() => toggleConnector(connector.id)}
              onSelect={(event) => event.preventDefault()}
            >
              <ConnectorIcon id={connector.id} size={16} />
              <span className="ModelItem-name">{connector.name}</span>
              {active.includes(connector.id) && <LuCheck className="DropdownMenuItem-check" aria-hidden="true" />}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
