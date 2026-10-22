/**
 * Polyfills and standard environment helpers.
 * Targets ES2024+ environments.
 */

// Ensure Promise.withResolvers is available if runtime does not support it natively
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    value: function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
    writable: true,
    configurable: true,
  });
}

// Ensure Object.groupBy is available if runtime does not support it natively
if (typeof Object.groupBy !== "function") {
  Object.defineProperty(Object, "groupBy", {
    value: function <K extends PropertyKey, T>(
      items: Iterable<T>,
      callbackfn: (item: T, index: number) => K
    ): Partial<Record<K, T[]>> {
      const result = Object.create(null) as Record<K, T[]>;
      let i = 0;
      for (const item of items) {
        const key = callbackfn(item, i++);
        if (key in result) {
          result[key].push(item);
        } else {
          result[key] = [item];
        }
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}

export {};
