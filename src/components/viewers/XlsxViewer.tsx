import { useEffect, useState } from "react";
import { errorMessage, getBasename, readSpreadsheet, type SpreadsheetSheet } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";
import { ViewerError, ViewerLoading, useZoom, ZoomControls } from "./ViewerChrome";

export function XlsxViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const zoom = useZoom(0.6, 2, 0.1);
  const fileName = getBasename(path);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);

    readSpreadsheet(path).then(
      (parsed) => {
        if (cancelled) return;
        setSheets(parsed);
        setActiveSheet(0);
      },
      (e) => {
        if (!cancelled) setError(errorMessage(e));
      }
    );

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <ViewerError message={error} />;
  if (!sheets) return <ViewerLoading label="Loading spreadsheet…" />;

  const current = sheets[activeSheet];
  const fontSize = Math.round(12 * zoom.zoom);

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
              onClick={() => setActiveSheet(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      <div
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
              {current.rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="XlsxViewer-row-num" style={{ fontSize: Math.round(fontSize * 0.9) }}>{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className="XlsxViewer-cell">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
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
