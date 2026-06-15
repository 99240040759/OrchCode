import Parser from 'web-tree-sitter'
import { join } from 'node:path'
import { getAppEnv } from './utils'
export type Language = Parser.Language
export type Node = Parser.SyntaxNode
const EXT_TO_WASM: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm', '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm', '.jsx': 'tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python.wasm', '.rs': 'tree-sitter-rust.wasm',
  '.go': 'tree-sitter-go.wasm', '.c': 'tree-sitter-c.wasm',
  '.cpp': 'tree-sitter-cpp.wasm', '.h': 'tree-sitter-c.wasm',
  '.hpp': 'tree-sitter-cpp.wasm', '.java': 'tree-sitter-java.wasm',
  '.cs': 'tree-sitter-c_sharp.wasm', '.rb': 'tree-sitter-ruby.wasm',
  '.php': 'tree-sitter-php.wasm', '.swift': 'tree-sitter-swift.wasm',
  '.kt': 'tree-sitter-kotlin.wasm', '.kts': 'tree-sitter-kotlin.wasm',
  '.html': 'tree-sitter-html.wasm', '.css': 'tree-sitter-css.wasm',
  '.json': 'tree-sitter-json.wasm', '.yaml': 'tree-sitter-yaml.wasm',
  '.yml': 'tree-sitter-yaml.wasm', '.toml': 'tree-sitter-toml.wasm',
  '.vue': 'tree-sitter-vue.wasm'
}
let isInitialized = false
const parserCache = new Map<string, Parser>()
export async function getParserForExtension(ext: string): Promise<Parser | null> {
  const key = ext.toLowerCase(), wasmFile = EXT_TO_WASM[key]
  if (!wasmFile) return null
  const cached = parserCache.get(key)
  if (cached) return cached
  const { isPackaged, resourcesPath, appPath } = getAppEnv()
  const wasmsDir = isPackaged ? join(resourcesPath, 'wasms') : join(appPath, 'resources', 'wasms')
  if (!isInitialized) {
    await Parser.init({ locateFile: (name) => name === 'tree-sitter.wasm' ? join(wasmsDir, 'tree-sitter.wasm') : name })
    isInitialized = true
  }
  const parser = new Parser(), Lang = await Parser.Language.load(join(wasmsDir, wasmFile))
  parser.setLanguage(Lang); parserCache.set(key, parser)
  return parser
}
export function getTokens(node: Node): Node[] {
  const tokens: Node[] = [], cursor = node.walk()
  let depth = 0
  while (true) {
    const current = cursor.currentNode()
    if (current.childCount === 0) tokens.push(current)
    if (cursor.gotoFirstChild()) depth++
    else {
      let moved = false
      while (depth > 0) {
        if (cursor.gotoNextSibling()) { moved = true; break }
        cursor.gotoParent(); depth--
      }
      if (!moved) break
    }
  }
  return tokens
}
export function findSyntaxErrors(node: Node): { line: number; column: number; text: string }[] {
  const errors: { line: number; column: number; text: string }[] = []
  function walk(n: Node) {
    if (n.type === 'ERROR' || n.isError()) errors.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, text: n.text })
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node); return errors
}
