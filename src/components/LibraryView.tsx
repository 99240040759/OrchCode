import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useDebouncedCallback } from "use-debounce";
import {
  countDocuments,
  deleteDocument,
  documentArtifactKind,
  documentTypeLabel,
  errorMessage,
  formatRelativeTime,
  ingestDocument,
  listDocuments,
  searchDocuments,
  type DocumentRecord,
  type IngestResultDto,
  type SearchHit,
} from "../lib/api";
import { useArtifactsStore } from "../lib/artifacts";
import { Button } from "./ui/Button";
import { ConnectorIcon } from "./icons/ConnectorIcon";
import { ExplorerIcon } from "./ChatPrimitives";

function DocumentTypeIcon({ type, name }: { type: string; name?: string }) {
  const fileName = name ?? `document.${type}`;
  return <ExplorerIcon type="file" name={fileName} width={18} height={18} className="LibraryRow-icon" />;
}

type ViewMode = "browse" | "search";

const PAGE_SIZE = 50;

interface DocumentRowProps {
  doc: DocumentRecord;
  onDelete: (id: string) => void;
  onOpen: (doc: DocumentRecord) => void;
  deleting: boolean;
}

function DocumentRow({ doc, onDelete, onOpen, deleting }: DocumentRowProps) {
  const [confirming, setConfirming] = useState(false);
  const pages = doc.pageCount ? `${doc.pageCount} pages` : null;
  const words = doc.wordCount ? `~${doc.wordCount.toLocaleString()} words` : null;
  const meta = [documentTypeLabel(doc.fileType), pages, words].filter(Boolean).join(" · ");
  const canOpen = Boolean(doc.filePath && documentArtifactKind(doc.fileType));

  return (
    <div
      className="LibraryRow"
      data-deleting={deleting}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={() => canOpen && onOpen(doc)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === "Enter" && canOpen) onOpen(doc);
      }}
    >
      <DocumentTypeIcon type={doc.fileType} name={doc.filePath ?? `${doc.title}.${doc.fileType}`} />
      <div className="LibraryRow-info">
        <span className="LibraryRow-title">{doc.title}</span>
        <span className="LibraryRow-meta">{meta}</span>
        {doc.filePath && (
          <span className="LibraryRow-path" title={doc.filePath}>
            {doc.filePath}
          </span>
        )}
      </div>
      <span className="LibraryRow-source" data-source={doc.source}>
        {doc.source !== "local" && <ConnectorIcon id={doc.source} size={12} />}
        {doc.source}
      </span>
      <span className="LibraryRow-time">{formatRelativeTime(doc.updatedAt)}</span>
      <div
        className="LibraryRow-actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {confirming ? (
          <>
            <Button
              className="LibraryRow-confirmYes"
              onClick={() => { setConfirming(false); onDelete(doc.id); }}
              disabled={deleting}
            >
              Remove
            </Button>
            <Button
              className="LibraryRow-confirmNo"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            className="LibraryRow-delete"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            aria-label={`Remove ${doc.title} from library`}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function SearchSnippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(<b>[\s\S]*?<\/b>)/gi);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^<b>([\s\S]*)<\/b>$/i.exec(part);
        return match ? <b key={index}>{match[1]}</b> : <span key={index}>{part}</span>;
      })}
    </>
  );
}

function SearchResultRow({ hit }: { hit: SearchHit }) {
  const page = hit.pageNumber ? ` — page ${hit.pageNumber}` : "";
  return (
    <div className="SearchResultRow">
      <div className="SearchResultRow-header">
        <DocumentTypeIcon type={hit.fileType} name={`${hit.documentTitle}.${hit.fileType}`} />
        <span className="SearchResultRow-title">{hit.documentTitle}</span>
        <span className="SearchResultRow-type">[{documentTypeLabel(hit.fileType)}{page}]</span>
        <span className="SearchResultRow-source">
          {hit.source !== "local" && <ConnectorIcon id={hit.source} size={12} />}
          {hit.source}
        </span>
      </div>
      <p className="SearchResultRow-snippet">
        <SearchSnippet snippet={hit.snippet} />
      </p>
    </div>
  );
}

export function LibraryView() {
  const openDocument = useArtifactsStore((s) => s.openDocument);
  const [view, setView] = useState<ViewMode>("browse");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResultDto | null>(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const searchSeqRef = useRef(0);

  const handleOpen = useCallback((doc: DocumentRecord) => {
    if (!doc.filePath) return;
    const kind = documentArtifactKind(doc.fileType);
    if (kind) openDocument(doc.filePath, kind, doc.title);
  }, [openDocument]);

  const loadDocuments = useCallback(async (requested: number) => {
    setLoading(true);
    setError(null);
    try {
      const count = await countDocuments();
      const lastPage = Math.max(0, Math.floor((count - 1) / PAGE_SIZE) * PAGE_SIZE);
      const off = Math.min(Math.max(0, requested), lastPage);
      const docs = await listDocuments({ limit: PAGE_SIZE, offset: off });
      offsetRef.current = off;
      setDocuments(docs);
      setTotalCount(count);
      setOffset(off);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void loadDocuments(0);
    void listen("documents-updated", () => {
      void loadDocuments(offsetRef.current);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadDocuments]);

  const runSearch = useDebouncedCallback(async (query: string) => {
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const hits = await searchDocuments(query, 30);
      if (seq === searchSeqRef.current) setSearchHits(hits);
    } catch (e) {
      if (seq === searchSeqRef.current) setError(errorMessage(e));
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, 350);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      runSearch.cancel();
      searchSeqRef.current += 1;
      setSearching(false);
      setSearchHits([]);
      setView("browse");
      return;
    }
    setView("search");
    setSearching(true);
    void runSearch(query);
  }, [runSearch]);

  const handleIngest = useCallback(async () => {
    setError(null);
    setIngestResult(null);
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "Documents",
            extensions: ["pdf", "docx", "xlsx", "xls", "ods", "pptx", "txt", "md", "markdown", "csv", "json", "html", "htm", "xml", "rtf"],
          },
        ],
      });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      setIngesting(true);
      const result = await ingestDocument(path);
      setIngestResult(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIngesting(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteDocument(id);
      setSearchHits((prev) => prev.filter((hit) => hit.documentId !== id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <div className="LibraryView">
      <header className="LibraryView-header">
        <div className="LibraryView-title-row">
          <h1 className="LibraryView-title">Knowledge Library</h1>
          <span className="LibraryView-count">
            {totalCount.toLocaleString()} document{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="LibraryView-subtitle">
          Index documents so the AI can search and cite them in any conversation.
        </p>
      </header>

      <div className="LibraryView-toolbar">
        <div className="LibraryView-search">
          <input
            className="LibraryView-searchInput"
            type="search"
            placeholder="Search indexed documents…"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search knowledge library"
          />
        </div>
        <Button
          className="LibraryView-addBtn"
          onClick={() => void handleIngest()}
          disabled={ingesting}
        >
          {ingesting ? "Indexing…" : "+ Add Document"}
        </Button>
      </div>

      {error && (
        <div className="LibraryView-error" role="alert">
          <strong>Error:</strong> {error}
          <Button onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {ingestResult && (
        <div className="LibraryView-success" role="status">
          {ingestResult.wasUpdate ? "Re-indexed" : "Indexed"}{" "}
          <strong>{ingestResult.title}</strong> — {ingestResult.passageCount} passages,{" "}
          ~{ingestResult.wordCount.toLocaleString()} words
          <Button onClick={() => setIngestResult(null)}>Dismiss</Button>
        </div>
      )}

      <div className="LibraryView-content">
        {view === "browse" && loading && <p className="LibraryView-loading">Loading…</p>}
        {view === "search" && searching && <p className="LibraryView-loading">Searching…</p>}

        {!loading && view === "browse" && (
          <>
            {documents.length === 0 ? (
              <div className="LibraryView-empty">
                <p>No documents indexed yet.</p>
                <p>Click <strong>+ Add Document</strong> to index a PDF, Word doc, Excel file, or presentation.</p>
              </div>
            ) : (
              <div className="LibraryView-list">
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onDelete={handleDelete}
                    onOpen={handleOpen}
                    deleting={deletingId === doc.id}
                  />
                ))}
              </div>
            )}

            {totalCount > PAGE_SIZE && (
              <div className="LibraryView-pagination">
                <Button
                  onClick={() => void loadDocuments(offset - PAGE_SIZE)}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <span>
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
                </span>
                <Button
                  onClick={() => void loadDocuments(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= totalCount}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {!searching && view === "search" && (
          <>
            {searchHits.length === 0 ? (
              <p className="LibraryView-noResults">
                No passages matched <em>{searchQuery}</em>.
              </p>
            ) : (
              <div className="LibraryView-searchResults">
                <p className="LibraryView-resultCount">
                  {searchHits.length} matching passage{searchHits.length !== 1 ? "s" : ""} for{" "}
                  <em>{searchQuery}</em>
                </p>
                {searchHits.map((hit) => (
                  <SearchResultRow key={hit.passageId} hit={hit} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
