import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { dataUrlToArrayBuffer, readBinaryFileAsDataUrl } from "../../lib/api";

interface XlsxViewerProps {
  path: string;
}

interface SheetData {
  name: string;
  rows: string[][];
}

export function XlsxViewer({ path }: XlsxViewerProps) {

  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    readBinaryFileAsDataUrl(path)
      .then((dataUrl) => {
        if (cancelled) return;
        const buf = dataUrlToArrayBuffer(dataUrl);
        const workbook = XLSX.read(buf, { type: "array" });
        const parsed: SheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
          const filtered = (rows as string[][]).filter((row) => row.some((c) => c !== ""));
          return { name, rows: filtered };
        });
        setSheets(parsed);
        setActiveSheet(0);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [path]);

  if (loading) {
    return (
      <div className="DocViewer-loading">
        <div className="DocViewer-spinner" />
        <span>Loading spreadsheet…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="DocViewer-error">
        <span className="DocViewer-error-icon">⚠</span>
        <p>{error}</p>
      </div>
    );
  }

  const current = sheets[activeSheet];

  return (
    <div className="XlsxViewer">
      {sheets.length > 1 && (
        <div className="XlsxViewer-tabs">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              className={`XlsxViewer-tab${i === activeSheet ? " active" : ""}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="XlsxViewer-scroll">
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

export default XlsxViewer;
