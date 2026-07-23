import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

export function Avatar({ src, fallback, className }: { src?: string | null; fallback: string; className?: string }) {
  const [hasError, setHasError] = useState(false);
  const prevSrc = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (prevSrc.current !== src) {
      prevSrc.current = src;
      setHasError(false);
    }
  }, [src]);

  return (
    <span className={cn("Avatar", className)}>
      {src && !hasError ? (
        <img src={src} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" onError={() => setHasError(true)} />
      ) : (
        fallback
      )}
    </span>
  );
}
