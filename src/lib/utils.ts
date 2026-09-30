import { useState, useCallback, useRef, useEffect } from "react";
import { clsx } from "clsx";

export { clsx as cn };

function normalizePath(pathStr: string): string {
  return pathStr.replace(/\\/g, "/");
}

export function splitPathParts(pathStr: string): string[] {
  return normalizePath(pathStr).split("/").filter(Boolean);
}

export function getBasename(pathStr: string): string {
  if (!pathStr) return "";
  const parts = normalizePath(pathStr).split("/");
  return parts[parts.length - 1] || pathStr;
}

export function getDirname(pathStr: string): string {
  if (!pathStr) return "";
  const parts = normalizePath(pathStr).split("/");
  parts.pop();
  return parts.join("/");
}

export function getExt(pathStr: string): string {
  const base = normalizePath(pathStr).split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export function isImagePath(pathStr: string): boolean {
  return IMAGE_EXTENSIONS.has(getExt(pathStr));
}

export function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-zA-Z0-9]+$/.test(value);
}

const MENTION_PATTERN = "(?:@\\[([^\\]]+)\\]|@([^\\s@]+))(#L\\d+(?:-\\d+)?)?";

export function createMentionRegex(): RegExp {
  return new RegExp(MENTION_PATTERN, "g");
}

const USD_FORMAT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(amount: number): string {
  return USD_FORMAT.format(amount);
}

export function useCopy(text: string, resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetMs);
      },
      () => setCopied(false)
    );
  }, [text, resetMs]);

  return { copied, copy };
}
