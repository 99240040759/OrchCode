import { useState, useEffect, useRef } from "react";
import { renderAsync } from "docx-preview";
import { readBinaryFileAsDataUrl, readParsedDocument, type ParsedDocumentDto } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";

interface DocxViewerProps {
  path: string;
  documentId?: string;
}

export function DocxViewer({ path }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackDoc, setFallbackDoc] = useState<ParsedDocumentDto | null>(null);

  const fileName = path.split(/[\\/]/).pop() ?? path;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFallbackDoc(null);

    async function loadDoc() {
      try {
        const dataUrl = await readBinaryFileAsDataUrl(path);
        const base64 = dataUrl.split(",")[1];
        if (!base64) throw new Error("Invalid file data");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        await renderAsync(bytes.buffer, containerRef.current, undefined, {
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true,
        });
        if (!cancelled) setLoading(false);
      } catch {
        try {
          const parsed = await readParsedDocument(path);
          if (!cancelled) {
            setFallbackDoc(parsed);
            setLoading(false);
          }
        } catch (e2) {
          if (!cancelled) {
            setError(String(e2));
            setLoading(false);
          }
        }
      }
    }

    void loadDoc();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const paragraphs = fallbackDoc?.fullText
    ? fallbackDoc.fullText.split("\n").filter((p) => p.trim().length > 0)
    : [];

  return (
    <div className="DocxViewer">
      <div className="DocxViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocxViewer-title">{fallbackDoc?.title ?? fileName}</span>
      </div>
      {loading && (
        <div className="DocViewer-loading">
          <div className="DocViewer-spinner" />
          <span>Loading document…</span>
        </div>
      )}
      {error && (
        <div className="DocViewer-error">
          <span className="DocViewer-error-icon">⚠</span>
          <p>{error}</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="DocxViewer-render"
        style={{ display: loading || error ? "none" : "block" }}
      />
      {fallbackDoc && !loading && !error && (
        <div className="DocxViewer-body">
          {paragraphs.length === 0 ? (
            <div className="DocViewer-empty">
              <p>No text content found in this document.</p>
            </div>
          ) : (
            paragraphs.map((p, i) => (
              <p key={i} className="DocxViewer-text">{p}</p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default DocxViewer;
