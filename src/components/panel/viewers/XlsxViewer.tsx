import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as XLSX from "xlsx";
import { errorMessage, readBinaryFile } from "../../../lib/api";
import { Button } from "../../ui/Button";
import { ViewerState, ViewerToolbar, useZoom } from "./ViewerToolbar";

const MAX_ROWS = 5_000;
const MAX_COLS = 200;

interface Sheet {
  name: string;
  rows: string[][];
  totalRows: number;
}

function parse(buffer: ArrayBuffer): Sheet[] {
  const book = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  return book.SheetNames.map((name) => {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: false });
    const rows: string[][] = [];
    let totalRows = 0;
    for (const line of raw) {
      if (!Array.isArray(line)) continue;
      const cells = line.slice(0, MAX_COLS).map((c) => (c == null ? "" : String(c)));
      if (cells.every((c) => !c)) continue;
      totalRows += 1;
      if (rows.length < MAX_ROWS) rows.push(cells);
    }
    return { name, rows, totalRows };
  });
}

export function XlsxViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const zoom = useZoom(0.6, 2, 0.1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    readBinaryFile(path).then(
      (buffer) => {
        if (cancelled) return;
        try {
          setSheets(parse(buffer));
          setActive(0);
        } catch (e) {
          setError(errorMessage(e));
        }
      },
      (e) => !cancelled && setError(errorMessage(e))
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  const sheet = sheets?.[active];
  const rowHeight = Math.max(22, Math.round(28 * zoom.zoom));
  const fontSize = Math.round(12 * zoom.zoom);
  const colSpan = (sheet?.rows[0]?.length ?? 0) + 1;

  const virtualizer = useVirtualizer({
    count: sheet?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
  });

  useEffect(() => virtualizer.measure(), [rowHeight, active, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const top = items[0]?.start ?? 0;
  const bottom = items.length ? Math.max(0, virtualizer.getTotalSize() - items[items.length - 1].end) : 0;

  return (
    <>
      <ViewerToolbar
        path={path}
        meta={sheet ? `${sheet.totalRows.toLocaleString()} rows` : undefined}
        zoom={sheets ? zoom : undefined}
      />
      <ViewerState loading={!sheets && !error} error={error} label="Loading spreadsheet…" />
      {sheets && (
        <div ref={scrollRef} className="sheet selectable" role="tabpanel">
          {sheet && sheet.totalRows > sheet.rows.length && (
            <div className="sheet-note">
              Showing first {sheet.rows.length.toLocaleString()} of {sheet.totalRows.toLocaleString()} rows
            </div>
          )}
          {sheet?.rows.length ? (
            <table style={{ fontSize }}>
              <tbody>
                {top > 0 && (
                  <tr style={{ height: top }}>
                    <td colSpan={colSpan} />
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.key} style={{ height: rowHeight }}>
                    <td>{item.index + 1}</td>
                    {sheet.rows[item.index].map((cell, i) => (
                      <td key={i} title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {bottom > 0 && (
                  <tr style={{ height: bottom }}>
                    <td colSpan={colSpan} />
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <p className="empty">No data in this sheet</p>
          )}
        </div>
      )}
      {sheets && sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((s, i) => (
            <Button
              key={`${s.name}-${i}`}
              size="sm"
              role="tab"
              aria-selected={i === active}
              active={i === active}
              onClick={() => {
                setActive(i);
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }}
            >
              {s.name}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
