import { useState, useCallback, useRef, useEffect } from "react";
import { clsx, type ClassValue } from "clsx";

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent);

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function normalizePath(pathStr: string): string {
  if (!pathStr) return "";
  const normalized = pathStr.replace(/\\/g, "/");
  const isAbs = normalized.startsWith("/");
  const parts = normalized.split("/").filter((p) => p && p !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbs) {
        stack.push("..");
      }
    } else {
      stack.push(part);
    }
  }
  const res = stack.join("/");
  return isAbs ? "/" + res : res || ".";
}

export function toRelativeWorkspacePath(path: string, workspaceRoot?: string | null): string {
  const clean = normalizePath(path);
  if (!workspaceRoot) return clean;
  const root = normalizePath(workspaceRoot);
  if (clean === root) return "";
  const prefix = root.endsWith("/") ? root : root + "/";
  if (clean.startsWith(prefix)) {
    return clean.slice(prefix.length);
  }
  return clean;
}

export function splitPathParts(pathStr: string): string[] {
  if (!pathStr) return [];
  return normalizePath(pathStr).split("/").filter(Boolean);
}

export function getBasename(pathStr: string): string {
  if (!pathStr) return "";
  const clean = pathStr.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

export function getDirname(pathStr: string): string {
  if (!pathStr) return "";
  const clean = pathStr.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return clean.slice(0, idx);
}

export function getExt(pathStr: string): string {
  if (!pathStr) return "";
  const base = getBasename(pathStr);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx + 1).toLowerCase();
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export function isImagePath(pathStr: string): boolean {
  return IMAGE_EXTENSIONS.has(getExt(pathStr));
}

export function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-zA-Z0-9]+$/.test(value);
}

const MENTION_PATTERN = "@\\[([^\\]]+)\\](#L\\d+(?:-\\d+)?)?|@([^\\s@,;:!?#]+)(#L\\d+(?:-\\d+)?)?";

export function createMentionRegex(): RegExp {
  return new RegExp(MENTION_PATTERN, "g");
}

export const AUTO_COMPACT_RATIO = 0.8;

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000;
    return thousands < 100
      ? `${trimTrailingZero(thousands.toFixed(1))}k`
      : `${Math.round(thousands)}k`;
  }
  return `${trimTrailingZero((tokens / 1_000_000).toFixed(1))}M`;
}

export function formatWindow(tokens: number): string {
  if (tokens >= 100_000) return formatTokens(Math.round(tokens / 10_000) * 10_000);
  return formatTokens(tokens);
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
