import { create } from "zustand";
import * as api from "./api";
import { useChatStore } from "./store";
import type { ConnectorDto } from "./api";

export const GITHUB_ID = "github";

interface ConnectorsState {
  connectors: ConnectorDto[];
  github: ConnectorDto | null;
  loaded: boolean;
  loadFailed: boolean;
  error: string | null;
}

interface ConnectorsActions {
  refresh: () => Promise<void>;
  setError: (message: string | null) => void;
  reset: () => void;
}

let refreshSeq = 0;

export const useConnectorsStore = create<ConnectorsState & ConnectorsActions>()((set) => ({
  connectors: [],
  github: null,
  loaded: false,
  loadFailed: false,
  error: null,

  refresh: async () => {
    const seq = ++refreshSeq;
    try {
      const connectors = await api.listConnectors();
      if (seq !== refreshSeq) return;
      const github = connectors.find((connector) => connector.id === GITHUB_ID) ?? null;
      set({ connectors, github, loaded: true, loadFailed: false });
      useChatStore
        .getState()
        .pruneConnectors(connectors.filter((connector) => connector.connected).map((connector) => connector.id));
    } catch (e) {
      if (seq !== refreshSeq) return;
      set({ loaded: true, loadFailed: true, error: api.errorMessage(e) });
    }
  },

  setError: (message) => set({ error: message }),

  reset: () => {
    refreshSeq += 1;
    set({ connectors: [], github: null, loaded: false, loadFailed: false, error: null });
  },
}));
