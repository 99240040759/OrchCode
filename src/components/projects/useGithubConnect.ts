import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage, getConnectorAuthUrl } from "../../lib/api";
import { GITHUB_ID, useConnectorsStore } from "../../lib/connectors";

const CONNECT_WAIT_MS = 120_000;

export function useGithubConnect() {
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
    }).then((stop) => (disposed ? stop() : (unlisten = stop)));
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

  return { connected, pending, error, connect };
}
