import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  countDocuments,
  deleteDocument,
  documentArtifactKind,
  documentTypeLabel,
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
      onKeyDown={(e) => e.key === "Enter" && canOpen && onOpen(doc)}
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
        {doc.source !== "local" && <ConnectorIcon id={doc.source} size={12} className="LibraryRow-sourceIcon" />}
        {doc.source}
      </span>
      <span className="LibraryRow-time">{formatRelativeTime(doc.updatedAt)}</span>
      <div className="LibraryRow-actions">
        {confirming ? (
          <>
            <Button
              className="LibraryRow-confirmYes"
              onClick={() => {
                setConfirming(false);
                onDelete(doc.id);
              }}
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

interface SearchResultRowProps {
  hit: SearchHit;
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

function SearchResultRow({ hit }: SearchResultRowProps) {
  const page = hit.pageNumber ? ` — page ${hit.pageNumber}` : "";
  return (
    <div className="SearchResultRow">
      <div className="SearchResultRow-header">
        <DocumentTypeIcon type={hit.fileType} name={`${hit.documentTitle}.${hit.fileType}`} />
        <span className="SearchResultRow-title">{hit.documentTitle}</span>
        <span className="SearchResultRow-type">[{documentTypeLabel(hit.fileType)}{page}]</span>
        <span className="SearchResultRow-source">
          {hit.source !== "local" && <ConnectorIcon id={hit.source} size={12} className="LibraryRow-sourceIcon" />}
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
  const [ingesting, setIngesting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResultDto | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);

  const handleOpen = useCallback((doc: DocumentRecord) => {
    if (!doc.filePath) return;
    const kind = documentArtifactKind(doc.fileType);
    if (kind) openDocument(doc.filePath, kind, doc.title, doc.id);
  }, [openDocument]);

  const loadDocuments = useCallback(async (off = 0) => {
    setLoading(true);
    setError(null);
    try {
      const [docs, count] = await Promise.all([
        listDocuments({ limit: LIMIT, offset: off }),
        countDocuments(),
      ]);
      setDocuments(docs);
      setTotalCount(count);
      setOffset(off);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void loadDocuments();
    void listen("documents-updated", () => {
      void loadDocuments();
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadDocuments]);

  useEffect(() => {
    return () => {
      searchRequestRef.current += 1;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const requestId = ++searchRequestRef.current;
    if (!query.trim()) {
      setSearchHits([]);
      setView("browse");
      setLoading(false);
      return;
    }
    setView("search");
    searchTimerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const hits = await searchDocuments(query, 30);
        if (requestId === searchRequestRef.current) setSearchHits(hits);
      } catch (e) {
        if (requestId === searchRequestRef.current) setError(String(e));
      } finally {
        if (requestId === searchRequestRef.current) setLoading(false);
      }
    }, 350);
  }, []);

  const handleIngest = useCallback(async () => {
    setError(null);
    setIngestResult(null);
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "Documents",
            extensions: ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "txt", "md", "csv", "json"],
          },
        ],
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : (selected as { path: string }).path;
      setIngesting(true);
      const result = await ingestDocument(path);
      setIngestResult(result);
      await loadDocuments(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setIngesting(false);
    }
  }, [loadDocuments]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setTotalCount((c) => Math.max(0, c - 1));
    } catch (e) {
      setError(String(e));
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
        {loading && <p className="LibraryView-loading">Loading…</p>}

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

            {totalCount > LIMIT && (
              <div className="LibraryView-pagination">
                <Button
                  onClick={() => void loadDocuments(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <span>
                  {offset + 1}–{Math.min(offset + LIMIT, totalCount)} of {totalCount}
                </span>
                <Button
                  onClick={() => void loadDocuments(offset + LIMIT)}
                  disabled={offset + LIMIT >= totalCount}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {!loading && view === "search" && (
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

export default LibraryView;
