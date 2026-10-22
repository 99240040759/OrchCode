import { useState, useCallback, useRef, useEffect } from "react";
import { clsx, type ClassValue } from "clsx";
import { normalize, basename, dirname, extname, relative, isAbsolute } from "pathe";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function normalizePath(pathStr: string): string {
  if (!pathStr) return "";
  return normalize(pathStr);
}

export function toRelativeWorkspacePath(path: string, workspaceRoot?: string | null): string {
  const clean = normalizePath(path);
  if (!workspaceRoot) return clean;
  const root = normalizePath(workspaceRoot);
  const rel = relative(root, clean);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    return rel;
  }
  return clean;
}

export function splitPathParts(pathStr: string): string[] {
  if (!pathStr) return [];
  return normalizePath(pathStr).split("/").filter(Boolean);
}

export function getBasename(pathStr: string): string {
  if (!pathStr) return "";
  return basename(pathStr);
}

export function getDirname(pathStr: string): string {
  if (!pathStr) return "";
  return dirname(pathStr);
}

export function getExt(pathStr: string): string {
  if (!pathStr) return "";
  const ext = extname(pathStr);
  return ext.startsWith(".") ? ext.slice(1).toLowerCase() : ext.toLowerCase();
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
