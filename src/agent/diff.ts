import { diffLines, type Change } from 'diff';
export interface DiffHunk { type: 'added' | 'removed' | 'common'; line: string; }
export function computeDiff(a: string, b: string): { added: number; removed: number; original: string; modified: string; hunks: DiffHunk[] } {
  const changes: Change[] = diffLines(a, b);
  const hunks: DiffHunk[] = [];
  let added = 0, removed = 0;
  for (const c of changes) {
    const lines = c.value.replace(/\n$/, '').split('\n');
    const type: DiffHunk['type'] = c.added ? 'added' : c.removed ? 'removed' : 'common';
    if (c.added) added += c.count || lines.length;
    if (c.removed) removed += c.count || lines.length;
    for (const line of lines) hunks.push({ type, line });
  }
  return { added, removed, original: a, modified: b, hunks };
}
