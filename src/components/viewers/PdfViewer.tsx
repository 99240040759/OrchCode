import { useState, useEffect } from "react";
import { readBinaryFileAsDataUrl } from "../../lib/api";

interface PdfViewerProps {
  path: string;
}

export function PdfViewer({ path }: PdfViewerProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataUrl(null);

    readBinaryFileAsDataUrl(path)
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setLoading(false);
        }
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
        <span>Loading PDF…</span>
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

  return (
    <div className="PdfViewer">
      <embed
        src={dataUrl!}
        type="application/pdf"
        className="PdfViewer-embed"
        title="PDF Document"
      />
    </div>
  );
}
