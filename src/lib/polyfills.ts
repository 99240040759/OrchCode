declare global {
  interface Map<K, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
    getOrInsert(key: K, defaultValue: V): V;
  }
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

if (typeof (Map.prototype as any).getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (this.has(key)) {
        return this.get(key)!;
      }
      if (typeof callbackfn !== "function") {
        throw new TypeError("callbackfn is not a function");
      }
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof (Map.prototype as any).getOrInsert !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsert", {
    value: function <K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
      if (this.has(key)) {
        return this.get(key)!;
      }
      this.set(key, defaultValue);
      return defaultValue;
    },
    writable: true,
    configurable: true,
  });
}

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

if (typeof (Object as any).groupBy !== "function") {
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

if (typeof (Map as any).groupBy !== "function") {
  Object.defineProperty(Map, "groupBy", {
    value: function <K, T>(
      items: Iterable<T>,
      callbackfn: (item: T, index: number) => K
    ): Map<K, T[]> {
      const result = new Map<K, T[]>();
      let i = 0;
      for (const item of items) {
        const key = callbackfn(item, i++);
        if (result.has(key)) {
          result.get(key)!.push(item);
        } else {
          result.set(key, [item]);
        }
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}

export {};
