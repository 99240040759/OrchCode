import React from "react";

export function ChromeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <img src="/chrome.svg" alt="Browser" className={className} style={{ width: 14, height: 14, flexShrink: 0, ...style }} />;
}

export default ChromeIcon;
