import { memo, useEffect, useState } from "react";

export const Avatar = memo(function Avatar({ src, fallback }: { src?: string | null; fallback: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className="avatar">
      {src && !failed ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : fallback}
    </span>
  );
});
