import { useEffect, useState } from "react";
import { errorMessage, readBinaryFile } from "../../lib/api";
import { ViewerError, ViewerLoading } from "./ViewerChrome";

export function PdfViewer({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);

    readBinaryFile(path).then(
      (buffer) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
        setUrl(objectUrl);
      },
      (e) => {
        if (!cancelled) setError(errorMessage(e));
      }
    );

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (error) return <ViewerError message={error} />;
  if (!url) return <ViewerLoading label="Loading PDF…" />;

  return (
    <div className="PdfViewer">
      <embed src={url} type="application/pdf" className="PdfViewer-embed" title="PDF Document" />
    </div>
  );
}
