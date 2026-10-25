import { create } from "zustand";
import * as api from "./api";
import { useChatStore } from "./store";
import type { ConnectorDto } from "./api";

interface ConnectorsState {
  connectors: ConnectorDto[];
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
  loaded: false,
  loadFailed: false,
  error: null,

  refresh: async () => {
    const seq = ++refreshSeq;
    try {
      const connectors = await api.listConnectors();
      if (seq !== refreshSeq) return;
      set({ connectors, loaded: true, loadFailed: false });
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
    set({ connectors: [], loaded: false, loadFailed: false, error: null });
  },
}));
