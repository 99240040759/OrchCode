import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { errorMessage, readBinaryFile } from "../../lib/api";
import { getBasename } from "../../lib/utils";
import { ExplorerIcon } from "../ChatPrimitives";
import { ViewerError, ViewerLoading, ZoomControls, PageControls, useZoom } from "./ViewerChrome";

if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export function PdfViewer({ path, active = true }: { path: string; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const zoom = useZoom(0.25, 4, 0.15);
  const zoomValue = zoom.zoom;
  const fileName = getBasename(path);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setNumPages(0);

    readBinaryFile(path)
      .then(async (buffer) => {
        if (cancelled) return;
        const task = pdfjsLib.getDocument({ data: buffer });
        loadingTaskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          try {
            void task.destroy();
          } catch {}
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        try {
          pdfDocRef.current.cleanup();
        } catch {}
        pdfDocRef.current = null;
      }
      if (loadingTaskRef.current) {
        try {
          void loadingTaskRef.current.destroy();
        } catch {}
        loadingTaskRef.current = null;
      }
    };
  }, [path]);

  const renderPage = useCallback(async (pageNum: number, scale: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {}
      renderTaskRef.current = null;
    }

    try {
      const pdfPage = await doc.getPage(pageNum);
      const ratio = window.devicePixelRatio || 1;
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: scale * ratio });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(baseViewport.width * scale)}px`;
      canvas.style.height = `${Math.floor(baseViewport.height * scale)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const task = pdfPage.render({
        canvasContext: ctx,
        canvas,
        viewport,
      });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e: any) {
      if (e?.name !== "RenderingCancelledException") {
        setError(errorMessage(e));
      }
    }
  }, []);

  useEffect(() => {
    if (!loading && !error && numPages > 0) {
      void renderPage(page, zoomValue);
    }
  }, [loading, error, numPages, page, zoomValue, renderPage]);

  const goToPrev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const goToNext = useCallback(
    () => setPage((p) => (numPages > 0 ? Math.min(numPages, p + 1) : 1)),
    [numPages]
  );
  const goTo = useCallback(
    (n: number) => setPage(numPages > 0 ? Math.min(Math.max(1, n), numPages) : 1),
    [numPages]
  );

  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest?.("input, textarea, [contenteditable='true'], [contenteditable=''], .Composer-input"))
      ) {
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goToPrev(); }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goToNext(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, goToPrev, goToNext]);

  const ready = !loading && !error;

  return (
    <div className="PdfViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} width={16} height={16} />
        <span className="DocViewer-title">{fileName}</span>
        {numPages > 0 && (
          <span className="DocViewer-meta">{numPages} page{numPages !== 1 ? "s" : ""}</span>
        )}
        {ready && (
          <div className="DocViewer-controls">
            {numPages > 1 && (
              <PageControls
                page={page}
                total={numPages}
                onPrev={goToPrev}
                onNext={goToNext}
                onGoto={goTo}
              />
            )}
            <ZoomControls {...zoom} />
          </div>
        )}
      </div>

      <div className="PdfViewer-scroll">
        {loading && <ViewerLoading label="Loading PDF…" />}
        {error && <ViewerError message={error} />}
        <canvas
          ref={canvasRef}
          className="PdfViewer-canvas"
          style={{ display: ready ? "block" : "none" }}
          aria-label={`Page ${page} of ${numPages}`}
          tabIndex={-1}
        />
      </div>
    </div>
  );
}
