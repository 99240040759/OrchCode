import { useEffect, useState } from "react";
import { errorMessage, readImageDataUrl } from "./api";

const CACHE_LIMIT = 200;

class LruImageCache {
  private readonly max: number;
  private readonly map = new Map<string, string>();

  constructor(max: number = CACHE_LIMIT) {
    this.max = max;
  }

  get(key: string): string | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

const cache = new LruImageCache(CACHE_LIMIT);
const inflight = new Map<string, Promise<string>>();

export function clearImageCache(): void {
  cache.clear();
  inflight.clear();
}

function loadImageDataUrl(path: string, version = 0): Promise<string> {
  const cacheKey = `${path}@${version}`;
  const cached = cache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const request = readImageDataUrl(path)
    .then((url) => {
      cache.set(cacheKey, url);
      return url;
    })
    .finally(() => {
      if (inflight.get(cacheKey) === request) {
        inflight.delete(cacheKey);
      }
    });

  inflight.set(cacheKey, request);
  return request;
}

interface ImageDataUrlState {
  src: string | null;
  error: string | null;
  loading: boolean;
}

export function useImageDataUrl(path: string | null | undefined, version = 0): ImageDataUrlState {
  const cacheKey = path ? `${path}@${version}` : null;
  const [state, setState] = useState<ImageDataUrlState>(() => {
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    return { src: cached ?? null, error: null, loading: Boolean(path && !cached) };
  });

  useEffect(() => {
    if (!path || !cacheKey) {
      setState({ src: null, error: null, loading: false });
      return;
    }
    const cached = cache.get(cacheKey);
    if (cached) {
      setState({ src: cached, error: null, loading: false });
      return;
    }
    let active = true;
    setState({ src: null, error: null, loading: true });
    loadImageDataUrl(path, version).then(
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
  }, [path, version, cacheKey]);

  return state;
}
