import { useMemo } from "react";
import { VscChevronRight, VscPlug } from "react-icons/vsc";
import { selectActiveConnectors, useChatStore } from "../../lib/store";
import { useConnectorsStore } from "../../lib/connectors";
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
  const connected = useMemo(() => connectors.filter((connector) => connector.connected), [connectors]);

  let emptyLabel = "No connected apps";
  if (loadFailed) emptyLabel = "Couldn't load connectors";
  else if (!loaded) emptyLabel = "Loading…";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <VscPlug />
        <span className="DropdownMenuSubTrigger-label">Connectors</span>
        {active.length > 0 && <span className="DropdownMenuSubTrigger-count">{active.length}</span>}
        <VscChevronRight className="DropdownMenuSubTrigger-chevron" />
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
              <ConnectorIcon id={connector.id} size={14} />
              <span className="ModelItem-name">{connector.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
