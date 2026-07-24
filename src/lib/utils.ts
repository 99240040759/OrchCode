export { clsx as cn } from "clsx";

export function newId(): string {
  return crypto.randomUUID();
}

export function splitPathParts(pathStr: string): string[] {
  return pathStr.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function getBasename(pathStr: string): string {
  if (!pathStr) return "";
  const parts = pathStr.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathStr;
}

export function getDirname(pathStr: string): string {
  if (!pathStr) return "";
  const parts = pathStr.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}

export function createMentionRegex(): RegExp {
  return /(?:@|@\[)([a-zA-Z0-9_\-./\\]+?\.[a-zA-Z0-9]+)\]?(#L\d+(?:-\d+)?)?/g;
}

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(amount: number): string {
  return USD_FORMAT.format(amount);
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

export function formatRelativeTime(ts?: number): string {
  if (!ts) return "now";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return RELATIVE_FORMAT.format(-diffMin, "minute");
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return RELATIVE_FORMAT.format(-diffHour, "hour");
  const diffDay = Math.floor(diffHour / 24);
  return RELATIVE_FORMAT.format(-diffDay, "day");
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  svg: "xml",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  sql: "sql",
};

export function getLanguageFromPath(pathStr: string): string {
  const filename = getBasename(pathStr).toLowerCase();
  if (filename === "dockerfile" || filename.startsWith("dockerfile."))
    return "dockerfile";
  if (filename === "makefile" || filename.endsWith(".mk")) return "makefile";
  if (filename.startsWith(".env")) return "bash";
  if (filename === ".gitignore" || filename === ".dockerignore") return "ini";
  const ext = filename.includes(".") ? filename.split(".").pop() ?? "" : "";
  return EXT_LANG_MAP[ext] ?? "plaintext";
}
