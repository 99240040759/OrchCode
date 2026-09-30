import { useState, useEffect } from "react";
import { errorMessage, readBinaryFile } from "../../lib/api";

interface PdfViewerProps {
  path: string;
}

export function PdfViewer({ path }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);

    readBinaryFile(path)
      .then((buffer) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (loading) {
    return (
      <div className="DocViewer-loading">
        <div className="DocViewer-spinner" />
        <span>Loading PDF…</span>
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className="DocViewer-error">
        <span className="DocViewer-error-icon">⚠</span>
        <p>{error ?? "The PDF could not be loaded."}</p>
      </div>
    );
  }

  return (
    <div className="PdfViewer">
      <embed src={url} type="application/pdf" className="PdfViewer-embed" title="PDF Document" />
    </div>
  );
}
