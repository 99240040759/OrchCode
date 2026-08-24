import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  listConnectors,
  disconnectConnector,
  getConnectorAuthUrl,
  type ConnectorDto,
} from "./api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface ConnectorsState {
  connectors: ConnectorDto[];
  loading: boolean;
  actionId: string | null;
  error: string | null;
  unlisten: UnlistenFn | null;
}

interface ConnectorsActions {
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  clearError: () => void;
  destroy: () => void;
}

export type ConnectorsStore = ConnectorsState & ConnectorsActions;

export const useConnectorsStore = create(
  immer<ConnectorsStore>((set, get) => ({
    connectors: [],
    loading: false,
    actionId: null,
    error: null,
    unlisten: null,

    initialize: async () => {
      set((s) => { s.loading = true; });
      try {
        const connectors = await listConnectors();
        set((s) => { s.connectors = connectors; s.loading = false; });
      } catch (e) {
        set((s) => { s.error = String(e); s.loading = false; });
      }

      const unlisten = await listen<{ connector: ConnectorDto | null; error: string | null }>(
        "connector-changed",
        async (event) => {
          if (event.payload.error) {
            set((s) => { s.error = event.payload.error; s.actionId = null; });
          }
          await get().refresh();
          set((s) => { s.actionId = null; });
        }
      );
      set((s) => { s.unlisten = unlisten; });
    },

    refresh: async () => {
      try {
        const connectors = await listConnectors();
        set((s) => { s.connectors = connectors; });
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    connect: async (id: string) => {
      set((s) => { s.actionId = id; s.error = null; });
      try {
        const url = await getConnectorAuthUrl(id);
        await openUrl(url);
      } catch (e) {
        set((s) => { s.error = String(e); s.actionId = null; });
      }
    },

    disconnect: async (id: string) => {
      set((s) => { s.actionId = id; s.error = null; });
      try {
        await disconnectConnector(id);
        await get().refresh();
      } catch (e) {
        set((s) => { s.error = String(e); });
      } finally {
        set((s) => { s.actionId = null; });
      }
    },

    clearError: () => set((s) => { s.error = null; }),

    destroy: () => {
      const { unlisten } = get();
      if (unlisten) unlisten();
      set((s) => { s.unlisten = null; });
    },
  }))
);
