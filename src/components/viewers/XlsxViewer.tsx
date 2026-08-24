import { useState, useEffect } from "react";
import { readParsedDocument } from "../../lib/api";

interface XlsxViewerProps {
  path: string;
}

function parseSheetsFromText(fullText: string): Array<{ name: string; rows: string[][] }> {
  const sheets: Map<string, string[][]> = new Map();
  let currentSheet = "Sheet1";

  const lines = fullText.split("\n");
  for (const line of lines) {
    const sheetMatch = line.match(/^=== Sheet: (.+) ===$/);
    if (sheetMatch) {
      currentSheet = sheetMatch[1];
      if (!sheets.has(currentSheet)) sheets.set(currentSheet, []);
      continue;
    }
    if (line.trim()) {
      const cells = line.split("\t");
      const existing = sheets.get(currentSheet);
      if (existing) {
        existing.push(cells);
      } else {
        sheets.set(currentSheet, [cells]);
      }
    }
  }

  return Array.from(sheets.entries()).map(([name, rows]) => ({ name, rows }));
}

export function XlsxViewer({ path }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<Array<{ name: string; rows: string[][] }>>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    readParsedDocument(path)
      .then((data) => {
        if (!cancelled) {
          const parsed = parseSheetsFromText(data.fullText);
          setSheets(parsed);
          setActiveSheet(0);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
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
