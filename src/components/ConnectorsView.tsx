import { useState, useEffect, useCallback, useMemo } from "react";
import {
  listConnectors,
  getConnectorAuthUrl,
  disconnectConnector,
  type ConnectorDto,
} from "../lib/api";
import { listen } from "@tauri-apps/api/event";
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

type FilterCategory = "all" | "connected" | "Cloud Storage" | "Communication" | "Dev Tools" | "Productivity";

export function ConnectorsView() {
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");

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
    void refresh();
    const unlisten = listen<{ connector: ConnectorDto | null; error: string | null }>(
      "connector-changed",
      (event) => {
        if (event.payload.error) {
          setError(event.payload.error);
        }
        void refresh();
        setActionId(null);
      }
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const handleConnect = useCallback(async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      const url = await getConnectorAuthUrl(id);
      const { openUrl } = await import("@tauri-apps/plugin-opener");
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

  const filterTabs: { id: FilterCategory; label: string; count: number }[] = [
    { id: "all", label: "All", count: connectors.length },
    { id: "connected", label: "Connected", count: connectedCount },
    {
      id: "Cloud Storage",
      label: "Cloud Storage",
      count: connectors.filter((c) => c.category === "Cloud Storage").length,
    },
    {
      id: "Communication",
      label: "Communication",
      count: connectors.filter((c) => c.category === "Communication").length,
    },
    {
      id: "Dev Tools",
      label: "Developer Tools",
      count: connectors.filter((c) => c.category === "Dev Tools").length,
    },
    {
      id: "Productivity",
      label: "Productivity",
      count: connectors.filter((c) => c.category === "Productivity").length,
    },
  ];

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

export default ConnectorsView;
