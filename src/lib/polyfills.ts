declare global {
  interface Map<K, V> {
    getOrInsertComputed?(key: K, callbackfn: (key: K) => V): V;
    getOrInsert?(key: K, defaultValue: V): V;
  }
  interface PromiseConstructor {
    withResolvers?<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: any) => void;
    };
  }
}

if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (this.has(key)) {
        return this.get(key)!;
      }
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof Map.prototype.getOrInsert !== "function") {
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
      let reject!: (reason?: any) => void;
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
    value: function (items: Iterable<any>, callbackfn: (item: any, index: number) => any) {
      const result: Record<string, any[]> = Object.create(null);
      let i = 0;
      for (const item of items) {
        const key = String(callbackfn(item, i++));
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
    value: function (items: Iterable<any>, callbackfn: (item: any, index: number) => any) {
      const result = new Map<any, any[]>();
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
