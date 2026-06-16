function isMonacoAlreadyInitialized(): boolean {
  return !!(window as any).__orchcodeMonacoInitialized
}
function markMonacoInitialized(): void {
  ;(window as any).__orchcodeMonacoInitialized = true
}
import { getOrchThemeColors } from './sharedUtils'

export async function setupMonaco(): Promise<void> {
  if (isMonacoAlreadyInitialized()) return
  const { textPrimary, accentBlue: ab, accentGreen: ag, accentOrange: ao, accentPurple: ap, accentRed: ar, textSecondary: ts, textMuted: tm } = getOrchThemeColors()
  const strip = (c: string) => c.replace('#', '')
  const accentBlue = strip(ab), accentGreen = strip(ag), accentOrange = strip(ao), accentPurple = strip(ap), accentRed = strip(ar), textSecondary = strip(ts), textMuted = strip(tm)
  const { loader } = await import('@monaco-editor/react')
  const monaco = await loader.init()
  if (monaco.languages.typescript) {
    try {
      const compilerOptions: any = {
        jsx: 4, allowNonTsExtensions: true, target: 99, module: 99,
        moduleResolution: 2, allowJs: true, checkJs: false, noEmit: true,
        esModuleInterop: true, allowSyntheticDefaultImports: true, strict: false, skipLibCheck: true,
      }
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
      // Enable TS diagnostics (syntax + semantic) — real squiggly lines
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
    } catch (e) { console.warn('[Monaco] TS/JS diagnostics or compiler options configuration failed:', e) }
  }
  // Keep JSON/HTML/CSS diagnostics off — no workspace type benefit
  for (const [lang, prop] of [['json', 'jsonDefaults'], ['html', 'htmlDefaults'], ['css', 'cssDefaults']] as const) {
    const ns = (monaco.languages as any)[lang]
    if (!ns) continue
    try {
      const defaults = ns[prop]
      if (typeof defaults?.setDiagnosticsOptions === 'function') defaults.setDiagnosticsOptions({ validate: false })
      else if (typeof defaults?.setOptions === 'function') defaults.setOptions({ validate: false })
    } catch (e) { console.warn(`[Monaco] ${lang.toUpperCase()} diagnostics configuration failed:`, e) }
  }
  const langSuffixes = ['', '.js', '.ts', '.tsx']
  const tokenRules = (base: string, fg: string) => langSuffixes.map(s => ({ token: `${base}${s}`, foreground: fg }))
  monaco.editor.defineTheme('orch-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...tokenRules('keyword', accentPurple),
      ...tokenRules('string', accentGreen),
      { token: 'comment', foreground: textMuted, fontStyle: 'italic' },
      { token: 'number', foreground: accentOrange },
      { token: 'regexp', foreground: accentRed },
      { token: 'type', foreground: accentOrange },
      { token: 'class', foreground: accentOrange },
      ...tokenRules('function', accentBlue),
      { token: 'variable', foreground: textSecondary },
      { token: 'variable.predefined', foreground: accentRed },
      { token: 'identifier', foreground: textSecondary }
    ],
    colors: {
      'editor.background': '#101010',
      'editor.foreground': textPrimary,
      'editorLineNumber.foreground': '#4b5263',
      'editorLineNumber.activeForeground': '#c8ccd4',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.selectionBackground': '#ffffff1a',
      'editor.inactiveSelectionBackground': '#ffffff0d',
      'editorWidget.background': '#101010',
      'editorWidget.border': '#ffffff0f',
      'editorHoverWidget.background': '#101010',
      'editorHoverWidget.border': '#ffffff0f',
      'scrollbarSlider.background': '#ffffff0f',
      'scrollbarSlider.hoverBackground': '#ffffff1a',
      'scrollbarSlider.activeBackground': '#ffffff26',
      'editorOverviewRuler.border': '#00000000',
      'editorOverviewRuler.background': '#101010',
      'editorOverviewRuler.addedForeground': '#00000000',
      'editorOverviewRuler.modifiedForeground': '#00000000',
      'editorOverviewRuler.deletedForeground': '#00000000',
      'editorOverviewRuler.errorForeground': `#${accentRed}80`,
      'editorOverviewRuler.warningForeground': `#${accentOrange}80`,
      'editorOverviewRuler.infoForeground': `#${accentBlue}60`,
      'editorError.foreground': `#${accentRed}`,
      'editorError.background': '#00000000',
      'editorError.border': '#00000000',
      'editorWarning.foreground': `#${accentOrange}`,
      'editorWarning.background': '#00000000',
      'editorWarning.border': '#00000000',
      'editorInfo.foreground': `#${accentBlue}`,
      'editorInfo.background': '#00000000',
      'editorInfo.border': '#00000000'
    }
  })
  markMonacoInitialized()
}
