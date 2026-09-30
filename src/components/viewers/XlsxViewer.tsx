import { useEffect, useState } from "react";
import { errorMessage, readSpreadsheet, type SpreadsheetSheet } from "../../lib/api";
import { ViewerError, ViewerLoading } from "./ViewerChrome";

export function XlsxViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="XlsxViewer">
      {sheets.length > 1 && (
        <div className="XlsxViewer-tabs" role="tablist">
          {sheets.map((sheet, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === activeSheet}
              key={`${sheet.name}-${index}`}
              className={`XlsxViewer-tab${index === activeSheet ? " active" : ""}`}
              onClick={() => setActiveSheet(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="XlsxViewer-scroll">
        {current?.truncated && (
          <div className="DocViewer-meta">
            Showing the first {current.rows.length.toLocaleString()} of {current.totalRows.toLocaleString()} rows
          </div>
        )}
        {current && current.rows.length > 0 ? (
          <table className="XlsxViewer-table">
            <tbody>
              {current.rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="XlsxViewer-row-num">{ri + 1}</td>
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
