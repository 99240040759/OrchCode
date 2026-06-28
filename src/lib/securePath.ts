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
      const rel = path.relative(realBase, res);
      // `..` escapes upward; an absolute `rel` means a different Windows drive (path.relative can't bridge drives).
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return res;
      throw new Error('Access Denied');
    }
    cur = path.dirname(cur);
  }
  throw new Error('Access Denied');
}
