import { useState, useEffect, useCallback, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { getConnectorAuthUrl, disconnectConnector, errorMessage, type ConnectorDto } from "../lib/api";
import { useConnectorsStore } from "../lib/connectors";
import { Button } from "./ui/Button";
import { ConnectorIcon } from "./icons/ConnectorIcon";

type PendingAction = { id: string; kind: "connect" | "disconnect" };

const CONNECT_WAIT_MS = 120_000;

interface ConnectorCardProps {
  connector: ConnectorDto;
  pending: PendingAction | null;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}

function ConnectorCard({ connector, pending, onConnect, onDisconnect }: ConnectorCardProps) {
  const own = pending?.id === connector.id ? pending.kind : null;
  const busy = pending !== null;

  return (
    <article className="ConnectorCard" data-connected={connector.connected}>
      <div className="ConnectorCard-top">
        <div className="ConnectorCard-icon">
          <ConnectorIcon id={connector.id} size={32} />
        </div>
        <div className="ConnectorCard-identity">
          <h3 className="ConnectorCard-name">{connector.name}</h3>
          <span className="ConnectorCard-category">
            {connector.category} · {connector.toolCount} tools
          </span>
        </div>
        <span className="ConnectorCard-badge" data-state={connector.connected ? "connected" : "available"}>
          {connector.connected ? "Connected" : "Available"}
        </span>
      </div>

      <p className="ConnectorCard-description">{connector.description}</p>

      <div className="ConnectorCard-footer">
        {connector.connected ? (
          <Button
            className="ConnectorCard-actionBtn ConnectorCard-actionBtn--disconnect"
            onClick={() => onDisconnect(connector.id)}
            disabled={busy}
          >
            {own === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : (
          <Button
            className="ConnectorCard-actionBtn ConnectorCard-actionBtn--connect"
            onClick={() => onConnect(connector.id)}
            disabled={busy}
          >
            {own === "connect" ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </article>
  );
}

export function ConnectorsView() {
  const connectors = useConnectorsStore((s) => s.connectors);
  const loaded = useConnectorsStore((s) => s.loaded);
  const error = useConnectorsStore((s) => s.error);
  const refresh = useConnectorsStore((s) => s.refresh);
  const setError = useConnectorsStore((s) => s.setError);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refresh();
    void listen<{ error: string | null }>("connector-changed", (event) => {
      if (event.payload.error) setError(event.payload.error);
      void refresh();
      setPending(null);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh, setError]);

  useEffect(() => {
    if (pending?.kind !== "connect") return;
    let focusTimer = 0;
    const onFocus = () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        void refresh();
      }, 300);
    };
    const timeout = window.setTimeout(() => setPending(null), CONNECT_WAIT_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (focusTimer) window.clearTimeout(focusTimer);
      window.clearTimeout(timeout);
    };
  }, [pending, refresh]);

  useEffect(() => {
    if (pending?.kind !== "connect") return;
    if (connectors.some((connector) => connector.id === pending.id && connector.connected)) {
      setPending(null);
    }
  }, [connectors, pending]);

  const handleConnect = useCallback(
    async (id: string) => {
      setPending({ id, kind: "connect" });
      setError(null);
      try {
        const url = await getConnectorAuthUrl(id);
        await openUrl(url);
      } catch (e) {
        setError(errorMessage(e));
        setPending(null);
      }
    },
    [setError]
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      setPending({ id, kind: "disconnect" });
      setError(null);
      try {
        await disconnectConnector(id);
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setPending(null);
      }
    },
    [refresh, setError]
  );

  const connectedCount = useMemo(() => connectors.filter((c) => c.connected).length, [connectors]);

  const filteredConnectors = useMemo(() => {
    if (activeFilter === "all") return connectors;
    if (activeFilter === "connected") return connectors.filter((c) => c.connected);
    return connectors.filter((c) => c.category === activeFilter);
  }, [connectors, activeFilter]);

  const filterTabs = useMemo(() => {
    const categories = Array.from(new Set(connectors.map((c) => c.category))).sort();
    return [
      { id: "all", label: "All", count: connectors.length },
      { id: "connected", label: "Connected", count: connectedCount },
      ...categories.map((cat) => ({
        id: cat,
        label: cat,
        count: connectors.filter((c) => c.category === cat).length,
      })),
    ];
  }, [connectors, connectedCount]);

  if (!loaded) {
    return (
      <div className="ConnectorsView ConnectorsView--loading">
        <p>Loading connectors…</p>
      </div>
    );
  }

  return (
    <div className="ConnectorsView">
      <div className="ConnectorsView-container">
        <header className="ConnectorsView-header">
          <div className="ConnectorsView-titleRow">
            <h1 className="ConnectorsView-title">Integrations</h1>
            <span className="ConnectorsView-statusPill">
              {connectedCount} of {connectors.length} connected
            </span>
          </div>
          <p className="ConnectorsView-subtitle">
            Connect your accounts, then choose which apps the agent can use in each chat from the + menu in the
            composer.
          </p>
          <nav className="ConnectorsView-filterBar" aria-label="Connector category filters">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="ConnectorsView-filterTab"
                data-active={activeFilter === tab.id}
                onClick={() => setActiveFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="ConnectorsView-filterCount">{tab.count}</span>
              </button>
            ))}
          </nav>
        </header>

        {error && (
          <div className="ConnectorsView-error" role="alert">
            <strong>Error:</strong> {error}
            <Button onClick={() => setError(null)}>Dismiss</Button>
          </div>
        )}

        <div className="ConnectorsView-grid">
          {filteredConnectors.map((c) => (
            <ConnectorCard
              key={c.id}
              connector={c}
              pending={pending}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
