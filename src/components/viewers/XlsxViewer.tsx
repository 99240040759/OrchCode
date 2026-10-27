import React, { useEffect, useState, useRef, useCallback } from "react";
import { errorMessage, readSpreadsheet, type SpreadsheetSheet } from "../../lib/api";
import { getBasename } from "../../lib/utils";
import { ExplorerIcon } from "../ChatPrimitives";
import { ViewerError, ViewerLoading, useZoom, ZoomControls } from "./ViewerChrome";

export function XlsxViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const zoom = useZoom(0.6, 2, 0.1);
  const fileName = getBasename(path);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);

    readSpreadsheet(path).then(
      (parsed) => {
        if (cancelled) return;
        setSheets(parsed);
        setActiveSheet(0);
        setScrollTop(0);
      },
      (e) => {
        if (!cancelled) setError(errorMessage(e));
      }
    );

    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 600);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeSheet]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (error) return <ViewerError message={error} />;
  if (!sheets) return <ViewerLoading label="Loading spreadsheet…" />;

  const current = sheets[activeSheet];
  const fontSize = Math.round(12 * zoom.zoom);
  const rowHeight = Math.max(22, Math.round(28 * zoom.zoom));
  const totalRows = current ? current.rows.length : 0;
  const colCount = current && current.rows[0] ? current.rows[0].length + 1 : 1;

  const overscan = 15;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const topSpace = startIndex * rowHeight;
  const bottomSpace = Math.max(0, (totalRows - endIndex) * rowHeight);
  const visibleRows = current ? current.rows.slice(startIndex, endIndex) : [];

  return (
    <div className="XlsxViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocViewer-title">{fileName}</span>
        {sheets.length > 0 && (
          <span className="DocViewer-meta">
            {sheets[activeSheet]?.rows.length.toLocaleString()} rows
          </span>
        )}
        <div className="DocViewer-controls">
          <ZoomControls {...zoom} />
        </div>
      </div>

      {sheets.length > 1 && (
        <div className="XlsxViewer-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((sheet, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === activeSheet}
              aria-controls={`xlsx-panel-${index}`}
              id={`xlsx-tab-${index}`}
              key={`${sheet.name}-${index}`}
              className={`XlsxViewer-tab${index === activeSheet ? " active" : ""}`}
              onClick={() => {
                setActiveSheet(index);
                setScrollTop(0);
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="XlsxViewer-scroll"
        role="tabpanel"
        id={`xlsx-panel-${activeSheet}`}
        aria-labelledby={`xlsx-tab-${activeSheet}`}
      >
        {current?.truncated && (
          <div className="DocViewer-meta XlsxViewer-trunc">
            Showing first {current.rows.length.toLocaleString()} of {current.totalRows.toLocaleString()} rows
          </div>
        )}
        {current && current.rows.length > 0 ? (
          <table className="XlsxViewer-table" style={{ fontSize }}>
            <tbody>
              {topSpace > 0 && <tr style={{ height: topSpace }}><td colSpan={colCount} /></tr>}
              {visibleRows.map((row, idx) => {
                const ri = startIndex + idx;
                return (
                  <tr key={ri} style={{ height: rowHeight }}>
                    <td className="XlsxViewer-row-num" style={{ fontSize: Math.round(fontSize * 0.9) }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="XlsxViewer-cell">
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {bottomSpace > 0 && <tr style={{ height: bottomSpace }}><td colSpan={colCount} /></tr>}
            </tbody>
          </table>
        ) : (
          <div className="DocViewer-empty">
            <p>No data rows found in this spreadsheet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
