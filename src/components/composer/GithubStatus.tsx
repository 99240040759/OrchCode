import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { errorMessage, getConnectorAuthUrl } from "../../lib/api";
import { GITHUB_ID, useConnectorsStore } from "../../lib/connectors";
import { ConnectorIcon } from "../icons/ConnectorIcon";
import { Button } from "../ui/Button";

const CONNECT_WAIT_MS = 120_000;

export function GithubStatus() {
  const connected = useConnectorsStore((s) => s.github?.connected ?? false);
  const refresh = useConnectorsStore((s) => s.refresh);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("connector-changed", () => {
      void refresh();
      setPending(false);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    if (connected) {
      setPending(false);
      return;
    }
    const onFocus = () => void refresh();
    const timeout = window.setTimeout(() => setPending(false), CONNECT_WAIT_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timeout);
    };
  }, [pending, connected, refresh]);

  const connect = async () => {
    setPending(true);
    setError(null);
    try {
      await openUrl(await getConnectorAuthUrl(GITHUB_ID));
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  };

  return (
    <Button className="GithubStatus" title={error ?? undefined} disabled={pending} onClick={() => void connect()}>
      <ConnectorIcon id={GITHUB_ID} size={16} />
      <span>{pending ? "Connecting…" : error ? "Retry connecting GitHub" : "Connect GitHub"}</span>
    </Button>
  );
}
