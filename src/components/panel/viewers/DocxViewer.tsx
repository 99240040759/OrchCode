import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { errorMessage, readBinaryFile } from "../../../lib/api";
import { ViewerState, ViewerToolbar, useZoom } from "./ViewerToolbar";

export function DocxViewer({ path }: { path: string }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const zoom = useZoom(0.4, 2, 0.1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    readBinaryFile(path)
      .then(async (buffer) => {
        const page = pageRef.current;
        if (cancelled || !page) return;
        page.innerHTML = "";
        await renderAsync(buffer, page, undefined, {
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true,
        });
      })
      .then(
        () => !cancelled && setLoading(false),
        (e) => {
          if (cancelled) return;
          setError(errorMessage(e));
          setLoading(false);
        }
      );
    return () => {
      cancelled = true;
    };
  }, [path]);

  const ready = !loading && !error;

  return (
    <>
      <ViewerToolbar path={path} zoom={ready ? zoom : undefined} />
      <ViewerState loading={loading} error={error} label="Loading document…" />
      <div className="canvas-view" hidden={!ready}>
        <div style={{ zoom: zoom.zoom }}>
          <div ref={pageRef} className="docx-page selectable" />
        </div>
      </div>
    </>
  );
}
