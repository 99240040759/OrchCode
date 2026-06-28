import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getLang } from '../lib/langMap';
// AST-backed file editing via web-tree-sitter + tree-sitter-wasms grammars.
// Used to disambiguate multi-occurrence targets at node boundaries and to validate syntax post-edit.
const req = createRequire(__filename);
const GRAMMAR: Record<string, string> = { typescript: 'typescript', javascript: 'javascript', python: 'python', c: 'c', cpp: 'cpp', csharp: 'c_sharp', java: 'java', go: 'go', rust: 'rust', ruby: 'ruby', php: 'php', css: 'css', html: 'html', json: 'json', yaml: 'yaml', toml: 'toml', kotlin: 'kotlin', swift: 'swift', scala: 'scala', lua: 'lua', dart: 'dart', elixir: 'elixir', ocaml: 'ocaml', sol: 'solidity', shell: 'bash', 'objective-c': 'objc' };
let _Parser: any = null, _ready: Promise<any> | null = null;
const _langs = new Map<string, any>();
const grammarName = (fp: string) => fp.split('.').pop()?.toLowerCase() === 'tsx' ? 'tsx' : GRAMMAR[getLang(fp)];
async function getParser() {
  if (!_ready) { _Parser = req('web-tree-sitter'); const dir = path.dirname(req.resolve('web-tree-sitter')); _ready = _Parser.init({ wasmBinary: readFileSync(path.join(dir, 'tree-sitter.wasm')) }); }
  await _ready; return _Parser;
}
async function loadLang(name: string) {
  if (_langs.has(name)) return _langs.get(name);
  const P = await getParser(), out = path.join(path.dirname(req.resolve('tree-sitter-wasms/package.json')), 'out');
  const L = await P.Language.load(readFileSync(path.join(out, `tree-sitter-${name}.wasm`)));
  _langs.set(name, L); return L;
}
async function parse(fp: string, src: string) {
  const name = grammarName(fp); if (!name) return null;
  try { const P = await getParser(), L = await loadLang(name), p = new P(); p.setLanguage(L); return p.parse(src); } catch { return null; }
}
// Collect every AST node whose source text equals `target` (boundary-exact, native tree-sitter).
function nodesWithText(root: any, target: string): any[] {
  const out: any[] = [], stack = [root];
  while (stack.length) { const n = stack.pop(); if (n.text === target) out.push(n); for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)); }
  return out;
}
const byteToChar = (s: string, byteOffset: number) => Buffer.from(s, 'utf8').subarray(0, byteOffset).toString('utf8').length;
const allIndexes = (s: string, t: string) => { const a: number[] = []; let i = s.indexOf(t); while (i !== -1) { a.push(i); i = s.indexOf(t, i + 1); } return a; };
// edit_file = exact verbatim string replacement (Claude Code / Aider style). Each target must resolve to a single
// location: if it appears once, replace it; if it appears multiple times, tree-sitter disambiguates and accepts
// only when exactly one whole node IS the target, else the model must add context. Syntax is validated after.
export async function applyEdits(filePath: string, source: string, replacements: { target: string; replacement: string }[]): Promise<{ content: string; warnings: string[] }> {
  let content = source; const warnings: string[] = [];
  for (const { target, replacement } of replacements) {
    if (!target) throw new Error('Empty target string');
    const idx = allIndexes(content, target);
    if (idx.length === 0) throw new Error(`Target string not found: "${target.slice(0, 80)}"`);
    let pos: number;
    if (idx.length === 1) pos = idx[0];
    else {
      const tree = await parse(filePath, content), nodes = tree ? nodesWithText(tree.rootNode, target) : [];
      if (nodes.length !== 1) throw new Error(`Ambiguous target ("${target.slice(0, 60)}") matched ${idx.length} times; add surrounding context so it is unique.`);
      pos = byteToChar(content, nodes[0].startIndex);
    }
    content = content.slice(0, pos) + replacement + content.slice(pos + target.length);
  }
  const before = await parse(filePath, source), after = await parse(filePath, content);
  if (before && after && !before.rootNode.hasError() && after.rootNode.hasError()) warnings.push('Edit introduced a syntax error; verify the result.');
  return { content, warnings };
}
