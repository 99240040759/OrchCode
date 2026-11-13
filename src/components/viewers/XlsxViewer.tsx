import { useEffect, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as XLSX from "xlsx";
import { errorMessage, readBinaryFile } from "../../lib/api";
import { getBasename } from "../../lib/utils";
import { ExplorerIcon } from "../ChatPrimitives";
import { ViewerError, ViewerLoading, useZoom, ZoomControls } from "./ViewerChrome";

const MAX_SPREADSHEET_ROWS = 5_000;
const MAX_SPREADSHEET_COLS = 200;

interface SpreadsheetSheet {
  name: string;
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

function parseSpreadsheetBuffer(buffer: ArrayBuffer): SpreadsheetSheet[] {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const rows: string[][] = [];
    let totalRows = 0;
    for (const rawRow of rawRows) {
      if (!Array.isArray(rawRow)) continue;
      const cells = rawRow
        .slice(0, MAX_SPREADSHEET_COLS)
        .map((cell) => (cell == null ? "" : String(cell)));
      if (cells.every((c) => c.length === 0)) continue;
      totalRows += 1;
      if (rows.length < MAX_SPREADSHEET_ROWS) {
        rows.push(cells);
      }
    }
    return {
      name,
      rows,
      totalRows,
      truncated: totalRows > rows.length,
    };
  });
}

export function XlsxViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const zoom = useZoom(0.6, 2, 0.1);
  const fileName = getBasename(path);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);

    readBinaryFile(path).then(
      (buffer) => {
        if (cancelled) return;
        try {
          setSheets(parseSpreadsheetBuffer(buffer));
          setActiveSheet(0);
        } catch (e) {
          setError(errorMessage(e));
        }
      },
      (e) => {
        if (!cancelled) setError(errorMessage(e));
      }
    );

    return () => {
      cancelled = true;
    };
  }, [path]);

  const current = sheets?.[activeSheet];
  const fontSize = Math.round(13 * zoom.zoom);
  const rowHeight = Math.max(22, Math.round(28 * zoom.zoom));
  const totalRows = current ? current.rows.length : 0;
  const colCount = current && current.rows[0] ? current.rows[0].length + 1 : 1;

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, activeSheet, virtualizer]);

  if (error) return <ViewerError message={error} />;
  if (!sheets) return <ViewerLoading label="Loading spreadsheet…" />;

  const virtualItems = virtualizer.getVirtualItems();
  const topSpace = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const bottomSpace =
    virtualItems.length > 0
      ? Math.max(0, virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end)
      : 0;

  return (
    <div className="XlsxViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} className="DocViewer-fileIcon" />
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
              {topSpace > 0 && (
                <tr style={{ height: topSpace }}>
                  <td colSpan={colCount} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const ri = virtualRow.index;
                const row = current.rows[ri];
                return (
                  <tr key={virtualRow.key} style={{ height: rowHeight }}>
                    <td className="XlsxViewer-row-num" style={{ fontSize: Math.round(fontSize * 0.9) }}>
                      {ri + 1}
                    </td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="XlsxViewer-cell">
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {bottomSpace > 0 && (
                <tr style={{ height: bottomSpace }}>
                  <td colSpan={colCount} />
                </tr>
              )}
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
