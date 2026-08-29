import { useState, useEffect, useCallback, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import {
  listConnectors,
  getConnectorAuthUrl,
  disconnectConnector,
  type ConnectorDto,
} from "../lib/api";
import { Button } from "./ui/Button";
import { ConnectorIcon } from "./icons/ConnectorIcon";

interface ConnectorCardProps {
  connector: ConnectorDto;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  loading: boolean;
}

function ConnectorCard({ connector, onConnect, onDisconnect, loading }: ConnectorCardProps) {
  return (
    <article className="ConnectorCard" data-connected={connector.hasToken}>
      <div className="ConnectorCard-top">
        <div className="ConnectorCard-icon">
          <ConnectorIcon id={connector.id} size={32} />
        </div>
        <div className="ConnectorCard-identity">
          <h3 className="ConnectorCard-name">{connector.name}</h3>
          <span className="ConnectorCard-category">{connector.category}</span>
        </div>
        <span
          className="ConnectorCard-badge"
          data-state={
            connector.hasToken
              ? "connected"
              : connector.isConfigured
              ? "configured"
              : "unconfigured"
          }
        >
          {connector.hasToken
            ? "Connected"
            : connector.isConfigured
            ? "Ready"
            : "Needs credentials"}
        </span>
      </div>

      <p className="ConnectorCard-description">{connector.description}</p>

      {connector.error && (
        <p className="ConnectorCard-error">{connector.error}</p>
      )}

      <div className="ConnectorCard-footer">
        {connector.hasToken ? (
          <Button
            className="ConnectorCard-actionBtn ConnectorCard-actionBtn--disconnect"
            onClick={() => onDisconnect(connector.id)}
            disabled={loading}
          >
            {loading ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : (
          <Button
            className="ConnectorCard-actionBtn ConnectorCard-actionBtn--connect"
            onClick={() => onConnect(connector.id)}
            disabled={loading || !connector.isConfigured}
            title={
              !connector.isConfigured
                ? "Add OAuth credentials to .env to enable this connector"
                : undefined
            }
          >
            {loading ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </article>
  );
}

export function ConnectorsView() {
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");

  const refresh = useCallback(async () => {
    try {
      const list = await listConnectors();
      setConnectors(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refresh();
    void listen<{ connector: ConnectorDto | null; error: string | null }>(
      "connector-changed",
      (event) => {
        if (event.payload.error) {
          setError(event.payload.error);
        }
        if (event.payload.connector) {
          setConnectors((prev) =>
            prev.map((c) =>
              c.id === event.payload.connector!.id ? event.payload.connector! : c
            )
          );
        } else {
          void refresh();
        }
        setActionId(null);
      }
    ).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const handleConnect = useCallback(async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      const url = await getConnectorAuthUrl(id);
      await openUrl(url);
    } catch (e) {
      setError(String(e));
      setActionId(null);
    }
  }, []);

  const handleDisconnect = useCallback(async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      await disconnectConnector(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionId(null);
    }
  }, [refresh]);

  const connectedCount = useMemo(
    () => connectors.filter((c) => c.hasToken).length,
    [connectors]
  );

  const filteredConnectors = useMemo(() => {
    if (activeFilter === "all") return connectors;
    if (activeFilter === "connected") return connectors.filter((c) => c.hasToken);
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

  if (loading) {
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
              {connectedCount} of {connectors.length} active
            </span>
          </div>
          <p className="ConnectorsView-subtitle">
            Connect external accounts to make documents, repos, and communications searchable across conversations.
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
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              loading={actionId === c.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
