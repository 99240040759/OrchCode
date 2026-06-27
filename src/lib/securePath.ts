import path from 'node:path';
import fs from 'node:fs';
export function secureResolve(baseDir: string, relOrAbs: string): string {
  const fp = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, relOrAbs);
  let cur = fp;
  while (cur && cur !== path.dirname(cur)) {
    if (fs.existsSync(cur)) {
      const real = fs.realpathSync(cur);
      const suffix = path.relative(cur, fp);
      const res = suffix ? path.join(real, suffix) : real;
      const realBase = fs.realpathSync(baseDir);
      if (path.relative(realBase, res).startsWith('..')) throw new Error('Access Denied');
      return res;
    }
    cur = path.dirname(cur);
  }
  throw new Error('Access Denied');
}
