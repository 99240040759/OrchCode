import Parser from 'web-tree-sitter'
import { join } from 'node:path'
import { app } from 'electron'
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
export async function getParserForExtension(ext: string): Promise<Parser | null> {
  const wasmFile = EXT_TO_WASM[ext.toLowerCase()]
  if (!wasmFile) return null
  if (!isInitialized) { await Parser.init(); isInitialized = true }
  const parser = new Parser()
  const isPackaged = process.env.IS_PACKAGED === 'true' || (app && app.isPackaged)
  const resourcesPath = process.env.RESOURCES_PATH || process.resourcesPath
  const appPath = process.env.APP_PATH || (app && app.getAppPath()) || process.cwd()
  const wasmsDir = isPackaged ? join(resourcesPath, 'wasms') : join(appPath, 'resources', 'wasms')
  const Lang = await Parser.Language.load(join(wasmsDir, wasmFile))
  parser.setLanguage(Lang)
  return parser
}
export function getTokens(node: Node): Node[] {
  if (node.childCount === 0) return [node]
  const tokens: Node[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) tokens.push(...getTokens(child))
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
  walk(node)
  return errors
}
export interface FileSymbol { name: string; type: 'class' | 'function' | 'method' | 'interface'; startLine: number; endLine: number }
export function getFileOutline(node: Node): FileSymbol[] {
  const outline: FileSymbol[] = []
  function walk(n: Node) {
    const t = n.type
    const isClass = t.includes('class_declaration') || t.includes('interface_declaration') || t.includes('struct_specifier') || t === 'struct_item'
    const isFunc = t.includes('function_declaration') || t.includes('function_definition') || t === 'method_definition' || t === 'arrow_function' || t === 'generator_function'
    if (isClass || isFunc) {
      let name = ''
      const nameNode = n.childForFieldName ? n.childForFieldName('name') : null
      if (nameNode) name = nameNode.text
      else {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && (c.type === 'identifier' || c.type === 'property_identifier' || c.type.includes('name'))) { name = c.text; break }
        }
      }
      if (name) {
        outline.push({
          name,
          type: isClass ? (t.includes('interface') ? 'interface' : 'class') : (t === 'method_definition' ? 'method' : 'function'),
          startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node)
  return outline
}
