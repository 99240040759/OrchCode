import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebouncedCallback } from "use-debounce";
import { LuChevronRight, LuRefreshCw } from "react-icons/lu";
import * as api from "../../lib/api";
import { getBasename, getDirname } from "../../lib/utils";
import { activeTabId, useArtifactsStore } from "../../lib/artifacts";
import { FileIcon } from "../common/FileIcon";
import { IconButton } from "../ui/Button";

const ROOT = "";
const ROW_HEIGHT = 24;
const INDENT = 12;
const SEARCH_LIMIT = 200;

interface TreeRow {
  entry: api.TreeEntry;
  depth: number;
  dir?: string;
}

function without(set: ReadonlySet<string>, ...paths: string[]): Set<string> {
  const next = new Set(set);
  paths.forEach((p) => next.delete(p));
  return next;
}

export function Explorer() {
  const treeId = useId();
  const openFile = useArtifactsStore((s) => s.openFile);
  const treeVersion = useArtifactsStore((s) => s.treeVersion);
  const activePath = useArtifactsStore((s) => s.tabs.find((t) => t.id === activeTabId(s))?.path);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<api.FileEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<string, api.DirListing>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const listingsRef = useRef(listings);
  const expandedRef = useRef(expanded);
  listingsRef.current = listings;
  expandedRef.current = expanded;
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const firstRun = useRef(true);

  const searchText = query.trim();
  const searchMode = searchText !== "";

  const refresh = useCallback(async () => {
    const paths = [ROOT, ...expandedRef.current];
    const results = await Promise.allSettled(paths.map((path) => api.listWorkspaceDir(path)));
    const next: Record<string, api.DirListing> = {};
    const gone: string[] = [];
    let rootError: string | null = null;
    results.forEach((result, i) => {
      if (result.status === "fulfilled") next[paths[i]] = result.value;
      else if (paths[i] === ROOT) rootError = api.errorMessage(result.reason);
      else gone.push(paths[i]);
    });
    setListings(next);
    setTreeError(rootError);
    if (gone.length) setExpanded((prev) => without(prev, ...gone));
  }, []);

  const refreshSoon = useDebouncedCallback(refresh, 300);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void refresh();
      return;
    }
    refreshSoon();
    return () => refreshSoon.cancel();
  }, [treeVersion, refresh, refreshSoon]);

  const runSearch = useDebouncedCallback(async (text: string) => {
    const id = ++requestRef.current;
    try {
      const result = await api.listWorkspaceFiles(text, SEARCH_LIMIT);
      if (id !== requestRef.current) return;
      setHits(result);
      setSearchError(null);
    } catch (e) {
      if (id !== requestRef.current) return;
      setHits([]);
      setSearchError(api.errorMessage(e));
    } finally {
      if (id === requestRef.current) setSearching(false);
    }
  }, 120);

  useEffect(() => {
    setFocusIndex(0);
    if (!searchText) {
      runSearch.cancel();
      requestRef.current += 1;
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    void runSearch(searchText);
    return () => runSearch.cancel();
  }, [searchText, runSearch]);

  const toggleDir = useCallback(async (path: string) => {
    if (expandedRef.current.has(path)) {
      setExpanded((prev) => without(prev, path));
      return;
    }
    setExpanded((prev) => new Set(prev).add(path));
    if (listingsRef.current[path]) return;
    try {
      const listing = await api.listWorkspaceDir(path);
      setListings((prev) => ({ ...prev, [path]: listing }));
    } catch (e) {
      setExpanded((prev) => without(prev, path));
      setTreeError(api.errorMessage(e));
    }
  }, []);

  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    if (searchMode) {
      for (const hit of hits) {
        out.push({
          entry: { name: getBasename(hit.path) || hit.name, path: hit.path, isDir: false },
          depth: 0,
          dir: getDirname(hit.path),
        });
      }
      return out;
    }
    const walk = (dir: string, depth: number) => {
      for (const entry of listings[dir]?.entries ?? []) {
        out.push({ entry, depth });
        if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk(ROOT, 0);
    return out;
  }, [searchMode, hits, listings, expanded]);

  const truncated = !searchMode && Object.values(listings).some((l) => l.truncated);
  const message = searchMode
    ? (searchError ?? (rows.length ? null : searching ? "Searching…" : "No files found"))
    : treeError;
  const focused = Math.min(focusIndex, Math.max(rows.length - 1, 0));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    paddingStart: 4,
  });

  const move = (index: number) => {
    setFocusIndex(index);
    virtualizer.scrollToIndex(index);
  };

  const activate = (row: TreeRow) => {
    if (row.entry.isDir) void toggleDir(row.entry.path);
    else openFile(row.entry.path);
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[focused];
    if (!row) return;
    const isOpen = row.entry.isDir && expanded.has(row.entry.path);
    switch (event.key) {
      case "ArrowDown":
        move(Math.min(focused + 1, rows.length - 1));
        break;
      case "ArrowUp":
        move(Math.max(focused - 1, 0));
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (!row.entry.isDir) return;
        if (!isOpen) void toggleDir(row.entry.path);
        else if (focused + 1 < rows.length) move(focused + 1);
        break;
      case "ArrowLeft":
        if (isOpen) {
          void toggleDir(row.entry.path);
          break;
        }
        for (let i = focused - 1; i >= 0; i--) {
          if (rows[i].depth < row.depth) {
            move(i);
            break;
          }
        }
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <aside className="explorer" aria-label="Files">
      <div className="explorer-head">
        <span>Files</span>
        <IconButton label="Refresh" size="sm" onClick={() => void refresh()}>
          <LuRefreshCw />
        </IconButton>
      </div>
      <div className="explorer-search">
        <input
          className="field"
          data-size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && rows.length) {
              e.preventDefault();
              scrollRef.current?.focus();
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Search files"
          aria-label="Search files"
          spellCheck={false}
        />
      </div>
      <div
        ref={scrollRef}
        className="tree"
        role={searchMode ? "listbox" : "tree"}
        aria-label={searchMode ? "Search results" : "Workspace files"}
        tabIndex={0}
        aria-activedescendant={rows.length ? `${treeId}-${focused}` : undefined}
        onKeyDown={onTreeKeyDown}
      >
        {message && <p className="empty">{message}</p>}
        <div className="tree-rows" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const { entry, depth, dir } = row;
            const isOpen = entry.isDir && expanded.has(entry.path);
            const isActive = !entry.isDir && entry.path === activePath;
            return (
              <div
                key={entry.path}
                id={`${treeId}-${item.index}`}
                role={searchMode ? "option" : "treeitem"}
                aria-level={searchMode ? undefined : depth + 1}
                aria-expanded={entry.isDir ? isOpen : undefined}
                aria-selected={isActive}
                data-focused={item.index === focused || undefined}
                data-active={isActive || undefined}
                className="row"
                style={{ transform: `translate3d(0, ${item.start}px, 0)`, paddingLeft: 10 + depth * INDENT }}
                onClick={() => {
                  setFocusIndex(item.index);
                  scrollRef.current?.focus();
                  activate(row);
                }}
              >
                {!searchMode &&
                  (entry.isDir ? (
                    <LuChevronRight className="tree-chevron" data-open={isOpen || undefined} />
                  ) : (
                    <span className="tree-spacer" />
                  ))}
                <FileIcon name={entry.name} folder={entry.isDir} />
                <span className="row-label">{entry.name}</span>
                {dir && dir !== "." && <span className="row-meta">{dir}</span>}
              </div>
            );
          })}
        </div>
        {truncated && <p className="empty">Some folders are too large to list in full.</p>}
      </div>
    </aside>
  );
}
