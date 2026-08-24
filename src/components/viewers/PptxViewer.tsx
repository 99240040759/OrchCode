import { useState, useEffect } from "react";
import { readParsedDocument } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";

interface PptxViewerProps {
  path: string;
}

interface Slide {
  number: number;
  text: string;
}

function parseSlidesFromText(fullText?: string | null): Slide[] {
  if (!fullText) return [];
  const slideMap: Map<number, string[]> = new Map();
  const rawSections = fullText.split(/=== Slide (\d+) ===/);

  for (let i = 1; i < rawSections.length; i += 2) {
    const slideNum = parseInt(rawSections[i], 10) || 1;
    const body = rawSections[i + 1]?.trim() ?? "";
    if (body) {
      slideMap.set(slideNum, [body]);
    }
  }

  if (slideMap.size === 0 && fullText.trim()) {
    return [{ number: 1, text: fullText.trim() }];
  }

  return Array.from(slideMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([number, texts]) => ({ number, text: texts.join("\n") }));
}

export function PptxViewer({ path }: PptxViewerProps) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fileName = path.split(/[\\/]/).pop() ?? path;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    readParsedDocument(path)
      .then((data) => {
        if (!cancelled) {
          setTitle(data?.title ?? null);
          const parsed = parseSlidesFromText(data?.fullText);
          setSlides(parsed);
          setActiveSlide(0);
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
        <span>Loading presentation…</span>
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

  if (slides.length === 0) {
    return (
      <div className="DocViewer-empty">
        <p>No slides found in this presentation.</p>
      </div>
    );
  }

  const current = slides[activeSlide] ?? slides[0] ?? { number: 1, text: "" };
  const lines = (current.text || "").split("\n").filter(Boolean);

  return (
    <div className="PptxViewer">
      <div className="DocxViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocxViewer-title">{title ?? fileName}</span>
        <span className="DocxViewer-meta">{slides.length} slide{slides.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="PptxViewer-stage">
        <div className="PptxViewer-slide">
          <div className="PptxViewer-slide-num">Slide {current.number}</div>
          <div className="PptxViewer-slide-content">
            {lines.length === 0 ? (
              <p className="PptxViewer-slide-body">Empty slide</p>
            ) : (
              lines.map((line, i) => (
                <p key={i} className={i === 0 ? "PptxViewer-slide-title" : "PptxViewer-slide-body"}>
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="PptxViewer-strip">
          {slides.map((s, i) => (
            <button
              key={s.number}
              className={`PptxViewer-thumb${i === activeSlide ? " active" : ""}`}
              onClick={() => setActiveSlide(i)}
              title={`Slide ${s.number}`}
            >
              <span className="PptxViewer-thumb-num">{s.number}</span>
              <span className="PptxViewer-thumb-preview">{(s.text || "").slice(0, 60)}</span>
            </button>
          ))}
        </div>
      )}

      {slides.length > 1 && (
        <div className="PptxViewer-nav">
          <button
            className="PptxViewer-nav-btn"
            disabled={activeSlide === 0}
            onClick={() => setActiveSlide((n) => Math.max(0, n - 1))}
          >
            ‹ Prev
          </button>
          <span className="PptxViewer-nav-label">
            {activeSlide + 1} / {slides.length}
          </span>
          <button
            className="PptxViewer-nav-btn"
            disabled={activeSlide === slides.length - 1}
            onClick={() => setActiveSlide((n) => Math.min(slides.length - 1, n + 1))}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

export default PptxViewer;
