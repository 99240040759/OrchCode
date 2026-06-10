import { Parser, Language, Node } from 'web-tree-sitter'
import { join } from 'node:path'
import { app } from 'electron'

const EXT_TO_WASM: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.rs': 'tree-sitter-rust.wasm',
  '.go': 'tree-sitter-go.wasm',
  '.c': 'tree-sitter-c.wasm',
  '.cpp': 'tree-sitter-cpp.wasm',
  '.h': 'tree-sitter-c.wasm',
  '.hpp': 'tree-sitter-cpp.wasm',
  '.java': 'tree-sitter-java.wasm',
  '.cs': 'tree-sitter-c_sharp.wasm',
  '.rb': 'tree-sitter-ruby.wasm',
  '.php': 'tree-sitter-php.wasm',
  '.swift': 'tree-sitter-swift.wasm',
  '.kt': 'tree-sitter-kotlin.wasm',
  '.kts': 'tree-sitter-kotlin.wasm',
  '.html': 'tree-sitter-html.wasm',
  '.css': 'tree-sitter-css.wasm',
  '.json': 'tree-sitter-json.wasm',
  '.yaml': 'tree-sitter-yaml.wasm',
  '.yml': 'tree-sitter-yaml.wasm',
  '.toml': 'tree-sitter-toml.wasm',
  '.vue': 'tree-sitter-vue.wasm'
}

let isInitialized = false

export async function getParserForExtension(ext: string): Promise<Parser | null> {
  const wasmFile = EXT_TO_WASM[ext.toLowerCase()]
  if (!wasmFile) return null

  if (!isInitialized) {
    await Parser.init()
    isInitialized = true
  }

  const parser = new Parser()
  const isPackaged = process.env.IS_PACKAGED === 'true' || (app && app.isPackaged)
  const resourcesPath = process.env.RESOURCES_PATH || process.resourcesPath
  const appPath = process.env.APP_PATH || (app && app.getAppPath()) || process.cwd()
  const wasmsDir = isPackaged ? join(resourcesPath, 'wasms') : join(appPath, 'resources', 'wasms')
  const Lang = await Language.load(join(wasmsDir, wasmFile))
  parser.setLanguage(Lang)
  return parser
}

export function getTokens(node: Node): Node[] {
  if (node.childCount === 0) {
    return [node]
  }
  const tokens: Node[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) tokens.push(...getTokens(child))
  }
  return tokens
}
