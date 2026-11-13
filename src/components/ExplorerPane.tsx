import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebouncedCallback } from "use-debounce";
import { LuChevronRight, LuRefreshCw } from "react-icons/lu";
import * as api from "../lib/api";
import { getBasename, getDirname } from "../lib/utils";
import { activeTabId, useArtifactsStore } from "../lib/artifacts";
import { ExplorerIcon } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

const ROOT = "";
const REFRESH_DELAY_MS = 300;
const SEARCH_DELAY_MS = 120;
const SEARCH_LIMIT = 200;

interface TreeRow {
  entry: api.TreeEntry;
  depth: number;
  dir?: string;
}

function readPxToken(name: string): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue(name), 10);
}

function ExplorerTree() {
  const treeId = useId();
  const openFile = useArtifactsStore((s) => s.openFile);
  const treeVersion = useArtifactsStore((s) => s.treeVersion);
  const activePath = useArtifactsStore((s) => {
    const id = activeTabId(s);
    return s.tabs.find((t) => t.id === id)?.path;
  });

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
  const rowSize = useMemo(() => readPxToken("--ctl-sm"), []);

  const searchText = query.trim();
  const searchMode = searchText !== "";

  const refresh = useCallback(async () => {
    const paths = [ROOT, ...expandedRef.current];
    const results = await Promise.allSettled(paths.map((path) => api.listWorkspaceDir(path)));
    const next: Record<string, api.DirListing> = {};
    const gone: string[] = [];
    let rootError: string | null = null;
    results.forEach((result, index) => {
      const path = paths[index];
      if (result.status === "fulfilled") next[path] = result.value;
      else if (path === ROOT) rootError = api.errorMessage(result.reason);
      else gone.push(path);
    });
    setListings(next);
    setTreeError(rootError);
    if (gone.length > 0) {
      setExpanded((prev) => {
        const pruned = new Set(prev);
        gone.forEach((path) => pruned.delete(path));
        return pruned;
      });
    }
  }, []);

  const refreshSoon = useDebouncedCallback(refresh, REFRESH_DELAY_MS);

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
  }, SEARCH_DELAY_MS);

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
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(path));
    if (listingsRef.current[path]) return;
    try {
      const listing = await api.listWorkspaceDir(path);
      setListings((prev) => ({ ...prev, [path]: listing }));
    } catch (e) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
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
      const listing = listings[dir];
      if (!listing) return;
      for (const entry of listing.entries) {
        out.push({ entry, depth });
        if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk(ROOT, 0);
    return out;
  }, [searchMode, hits, listings, expanded]);

  const truncated = useMemo(
    () => !searchMode && Object.values(listings).some((l) => l.truncated),
    [searchMode, listings]
  );

  const message = searchMode
    ? (searchError ?? (rows.length > 0 ? null : searching ? "Searching…" : "No files found"))
    : treeError;

  const focused = Math.min(focusIndex, Math.max(rows.length - 1, 0));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowSize,
    overscan: 16,
  });

  const move = useCallback(
    (index: number) => {
      setFocusIndex(index);
      virtualizer.scrollToIndex(index);
    },
    [virtualizer]
  );

  const activate = useCallback(
    (row: TreeRow) => {
      if (row.entry.isDir) void toggleDir(row.entry.path);
      else openFile(row.entry.path);
    },
    [toggleDir, openFile]
  );

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
      case "ArrowLeft": {
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
      }
      case "Enter":
      case " ":
        activate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && rows.length > 0) {
      event.preventDefault();
      scrollRef.current?.focus();
    } else if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      setQuery("");
    }
  };

  const rowId = (index: number) => `${treeId}-${index}`;

  return (
    <>
      <div className="ExplorerPane-header">
        <span className="ExplorerPane-title">Files</span>
        <Tooltip content="Refresh file tree" side="bottom">
          <Button className="IconBtn" aria-label="Refresh file tree" onClick={() => void refresh()}>
            <LuRefreshCw />
          </Button>
        </Tooltip>
      </div>
      <div className="ExplorerPane-search">
        <input
          className="SearchInput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search files"
          aria-label="Search workspace files"
          spellCheck={false}
        />
      </div>
      <div
        ref={scrollRef}
        className="ExplorerTree"
        role={searchMode ? "listbox" : "tree"}
        aria-label={searchMode ? "Search results" : "Workspace files"}
        tabIndex={0}
        aria-activedescendant={rows.length > 0 ? rowId(focused) : undefined}
        onKeyDown={onTreeKeyDown}
      >
        {message && <p className="ExplorerPane-empty">{message}</p>}
        <div className="ExplorerTree-virtual" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const { entry, depth, dir } = row;
            const isOpen = entry.isDir && expanded.has(entry.path);
            const isActive = !entry.isDir && entry.path === activePath;
            return (
              <div
                key={entry.path}
                id={rowId(virtualRow.index)}
                role={searchMode ? "option" : "treeitem"}
                aria-level={searchMode ? undefined : depth + 1}
                aria-expanded={entry.isDir ? isOpen : undefined}
                aria-selected={isActive}
                data-focused={virtualRow.index === focused || undefined}
                data-active={isActive || undefined}
                className="TreeRow"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `calc(var(--sp-2) + ${depth} * var(--tree-indent))`,
                }}
                onClick={() => {
                  setFocusIndex(virtualRow.index);
                  scrollRef.current?.focus();
                  activate(row);
                }}
              >
                {!searchMode &&
                  (entry.isDir ? (
                    <LuChevronRight className="TreeRow-chevron" data-open={isOpen || undefined} />
                  ) : (
                    <span className="TreeRow-chevronSpacer" />
                  ))}
                <ExplorerIcon
                  type={entry.isDir ? "folder" : "file"}
                  name={entry.name}
                  className="TreeRow-icon"
                  aria-hidden="true"
                />
                <span className="TreeRow-name">{entry.name}</span>
                {dir && <span className="TreeRow-dir">{dir}</span>}
              </div>
            );
          })}
        </div>
        {truncated && <p className="ExplorerPane-empty">Some folders are too large to list in full.</p>}
      </div>
    </>
  );
}

export function ExplorerPane() {
  return (
    <aside className="ExplorerPane" aria-label="File explorer">
      <ExplorerTree />
    </aside>
  );
}
