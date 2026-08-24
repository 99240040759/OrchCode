import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  listDocuments,
  searchDocuments,
  deleteDocument,
  ingestDocument,
  countDocuments,
  type DocumentRecord,
  type SearchHit,
  type IngestResultDto,
} from "./api";

interface DocumentsState {
  documents: DocumentRecord[];
  totalCount: number;
  offset: number;
  limit: number;
  sourceFilter: string | undefined;
  typeFilter: string | undefined;
  searchQuery: string;
  searchResults: SearchHit[];
  loading: boolean;
  ingesting: boolean;
  deletingId: string | null;
  ingestResult: IngestResultDto | null;
  error: string | null;
}

interface DocumentsActions {
  loadDocuments: (off?: number) => Promise<void>;
  search: (query: string) => Promise<void>;
  setFilters: (source?: string, fileType?: string) => void;
  ingest: (path: string) => Promise<IngestResultDto>;
  remove: (id: string) => Promise<void>;
  clearIngestResult: () => void;
  clearError: () => void;
}

export type DocumentsStore = DocumentsState & DocumentsActions;

const LIMIT = 50;

export const useDocumentsStore = create(
  immer<DocumentsStore>((set, get) => ({
    documents: [],
    totalCount: 0,
    offset: 0,
    limit: LIMIT,
    sourceFilter: undefined,
    typeFilter: undefined,
    searchQuery: "",
    searchResults: [],
    loading: false,
    ingesting: false,
    deletingId: null,
    ingestResult: null,
    error: null,

    loadDocuments: async (off = 0) => {
      const { sourceFilter, typeFilter } = get();
      set((s) => { s.loading = true; s.error = null; });
      try {
        const [docs, count] = await Promise.all([
          listDocuments({ source: sourceFilter, fileType: typeFilter, limit: LIMIT, offset: off }),
          countDocuments(),
        ]);
        set((s) => {
          s.documents = docs;
          s.totalCount = count;
          s.offset = off;
          s.loading = false;
          s.searchQuery = "";
          s.searchResults = [];
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.loading = false; });
      }
    },

    search: async (query: string) => {
      set((s) => { s.searchQuery = query; });
      if (!query.trim()) {
        set((s) => { s.searchResults = []; });
        return;
      }
      set((s) => { s.loading = true; });
      try {
        const results = await searchDocuments(query, 30);
        set((s) => { s.searchResults = results; s.loading = false; });
      } catch (e) {
        set((s) => { s.error = String(e); s.loading = false; });
      }
    },

    setFilters: (source?: string, fileType?: string) => {
      set((s) => { s.sourceFilter = source; s.typeFilter = fileType; });
      void get().loadDocuments(0);
    },

    ingest: async (path: string) => {
      set((s) => { s.ingesting = true; s.error = null; s.ingestResult = null; });
      try {
        const result = await ingestDocument(path);
        set((s) => { s.ingestResult = result; s.ingesting = false; });
        await get().loadDocuments(0);
        return result;
      } catch (e) {
        set((s) => { s.error = String(e); s.ingesting = false; });
        throw e;
      }
    },

    remove: async (id: string) => {
      set((s) => { s.deletingId = id; s.error = null; });
      try {
        await deleteDocument(id);
        set((s) => {
          s.documents = s.documents.filter((d) => d.id !== id);
          s.totalCount = Math.max(0, s.totalCount - 1);
          s.deletingId = null;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.deletingId = null; });
      }
    },

    clearIngestResult: () => set((s) => { s.ingestResult = null; }),
    clearError: () => set((s) => { s.error = null; }),
  }))
);
