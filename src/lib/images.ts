import { useEffect, useState } from "react";
import { errorMessage, readImageDataUrl } from "./api";

const CACHE_LIMIT = 200;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function remember(path: string, url: string) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, url);
}

function loadImageDataUrl(path: string, fresh = false): Promise<string> {
  if (!fresh) {
    const cached = cache.get(path);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(path);
    if (pending) return pending;
  }
  const request = readImageDataUrl(path)
    .then((url) => {
      remember(path, url);
      return url;
    })
    .finally(() => {
      if (inflight.get(path) === request) inflight.delete(path);
    });
  inflight.set(path, request);
  return request;
}

export interface ImageDataUrlState {
  src: string | null;
  error: string | null;
  loading: boolean;
}

export function useImageDataUrl(path: string | null | undefined, version = 0): ImageDataUrlState {
  const [state, setState] = useState<ImageDataUrlState>(() => {
    const cached = path ? cache.get(path) : undefined;
    return { src: cached ?? null, error: null, loading: Boolean(path && !cached) };
  });

  useEffect(() => {
    if (!path) {
      setState({ src: null, error: null, loading: false });
      return;
    }
    const cached = version === 0 ? cache.get(path) : undefined;
    if (cached) {
      setState({ src: cached, error: null, loading: false });
      return;
    }
    let active = true;
    setState({ src: null, error: null, loading: true });
    loadImageDataUrl(path, version > 0).then(
      (src) => {
        if (active) setState({ src, error: null, loading: false });
      },
      (e) => {
        if (active) setState({ src: null, error: errorMessage(e), loading: false });
      }
    );
    return () => {
      active = false;
    };
  }, [path, version]);

  return state;
}
