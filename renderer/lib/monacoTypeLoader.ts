import { workspaceService } from '../services/services'

let loadedWorkspacePath: string | null = null
let disposables: Array<{ dispose: () => void }> = []

export async function loadWorkspaceTypes(workspacePath: string): Promise<void> {
  if (loadedWorkspacePath === workspacePath) return
  const { loader } = await import('@monaco-editor/react')
  const monaco = await loader.init()
  if (!monaco.languages.typescript) return
  // Dispose previous extraLibs
  for (const d of disposables) d.dispose()
  disposables = []
  loadedWorkspacePath = workspacePath
  // Load tsconfig compilerOptions
  try {
    const tsconfig = await workspaceService.readTsConfig(workspacePath)
    if (tsconfig) {
      const mapped: Record<string, any> = {
        allowJs: tsconfig.allowJs ?? true,
        checkJs: tsconfig.checkJs ?? false,
        jsx: mapJsx(tsconfig.jsx),
        target: 99, // ESNext
        module: 99, // ESNext
        moduleResolution: 2, // NodeJs
        allowNonTsExtensions: true,
        noEmit: true,
        esModuleInterop: tsconfig.esModuleInterop ?? true,
        allowSyntheticDefaultImports: tsconfig.allowSyntheticDefaultImports ?? true,
        strict: tsconfig.strict ?? false,
        skipLibCheck: true,
        ...(tsconfig.baseUrl ? { baseUrl: tsconfig.baseUrl } : {}),
        ...(tsconfig.paths ? { paths: tsconfig.paths } : {}),
      }
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(mapped)
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(mapped)
    }
  } catch (e) { console.warn('[MonacoTypeLoader] Failed to load tsconfig:', e) }
  // Load @types from node_modules
  try {
    const libs = await workspaceService.readTypeLibs(workspacePath)
    for (const lib of libs) {
      const d = monaco.languages.typescript.typescriptDefaults.addExtraLib(lib.content, lib.filePath)
      disposables.push(d)
    }
    console.info(`[MonacoTypeLoader] Loaded ${libs.length} type packages for ${workspacePath}`)
  } catch (e) { console.warn('[MonacoTypeLoader] Failed to load type libs:', e) }
}

export function clearWorkspaceTypes(): void {
  for (const d of disposables) d.dispose()
  disposables = []
  loadedWorkspacePath = null
}

function mapJsx(jsx?: string): number {
  if (!jsx) return 4 // react-jsx
  const lower = jsx.toLowerCase()
  if (lower === 'preserve') return 1
  if (lower === 'react') return 2
  if (lower === 'react-native') return 3
  if (lower === 'react-jsx') return 4
  if (lower === 'react-jsxdev') return 5
  return 4
}
