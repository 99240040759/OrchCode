function isMonacoAlreadyInitialized(): boolean {
  return !!(window as unknown as { __orchcodeMonacoInitialized?: boolean })
    .__orchcodeMonacoInitialized
}

function markMonacoInitialized(): void {
  ;(window as unknown as { __orchcodeMonacoInitialized?: boolean }).__orchcodeMonacoInitialized =
    true
}

export async function setupMonaco(): Promise<void> {
  if (isMonacoAlreadyInitialized()) {
    return
  }

  const rootStyle = getComputedStyle(document.documentElement)
  const textPrimary = rootStyle.getPropertyValue('--text-primary').trim() || '#f3f3f3'
  const accentBlue = (rootStyle.getPropertyValue('--accent-blue').trim() || '#3b82f6').replace(
    '#',
    ''
  )
  const accentGreen = (rootStyle.getPropertyValue('--accent-green').trim() || '#10b981').replace(
    '#',
    ''
  )
  const accentOrange = (rootStyle.getPropertyValue('--accent-orange').trim() || '#f59e0b').replace(
    '#',
    ''
  )
  const accentPurple = (rootStyle.getPropertyValue('--accent-purple').trim() || '#8b5cf6').replace(
    '#',
    ''
  )
  const accentRed = (rootStyle.getPropertyValue('--accent-red').trim() || '#ef4444').replace(
    '#',
    ''
  )
  const textSecondary = (
    rootStyle.getPropertyValue('--text-secondary').trim() || '#a1a1aa'
  ).replace('#', '')
  const textMuted = (rootStyle.getPropertyValue('--text-muted').trim() || '#71717a').replace(
    '#',
    ''
  )

  const { loader } = await import('@monaco-editor/react')
  const monaco = await loader.init()

  if (monaco.languages.typescript) {
    try {
      const compilerOptions = {
        jsx: 1,
        allowNonTsExtensions: true,
        target: 99,
        allowJs: true,
        checkJs: false
      }
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)

      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true
      })
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true
      })
    } catch (e) {
      console.warn('[Monaco] TS/JS diagnostics or compiler options configuration failed:', e)
    }
  }
  if (monaco.languages.json) {
    try {
      if (typeof monaco.languages.json.jsonDefaults?.setDiagnosticsOptions === 'function') {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false })
      } else if (typeof monaco.languages.json.jsonDefaults?.setOptions === 'function') {
        monaco.languages.json.jsonDefaults.setOptions({ validate: false })
      }
    } catch (e) {
      console.warn('[Monaco] JSON diagnostics configuration failed:', e)
    }
  }
  if (monaco.languages.html) {
    try {
      if (typeof monaco.languages.html.htmlDefaults?.setDiagnosticsOptions === 'function') {
        monaco.languages.html.htmlDefaults.setDiagnosticsOptions({ validate: false })
      } else if (typeof monaco.languages.html.htmlDefaults?.setOptions === 'function') {
        monaco.languages.html.htmlDefaults.setOptions({ validate: false })
      }
    } catch (e) {
      console.warn('[Monaco] HTML diagnostics configuration failed:', e)
    }
  }
  if (monaco.languages.css) {
    try {
      if (typeof monaco.languages.css.cssDefaults?.setDiagnosticsOptions === 'function') {
        monaco.languages.css.cssDefaults.setDiagnosticsOptions({ validate: false })
      } else if (typeof monaco.languages.css.cssDefaults?.setOptions === 'function') {
        monaco.languages.css.cssDefaults.setOptions({ validate: false })
      }
    } catch (e) {
      console.warn('[Monaco] CSS diagnostics configuration failed:', e)
    }
  }

  monaco.editor.defineTheme('orch-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: accentPurple },
      { token: 'keyword.js', foreground: accentPurple },
      { token: 'keyword.ts', foreground: accentPurple },
      { token: 'keyword.tsx', foreground: accentPurple },
      { token: 'string', foreground: accentGreen },
      { token: 'string.js', foreground: accentGreen },
      { token: 'string.ts', foreground: accentGreen },
      { token: 'string.tsx', foreground: accentGreen },
      { token: 'comment', foreground: textMuted, fontStyle: 'italic' },
      { token: 'number', foreground: accentOrange },
      { token: 'regexp', foreground: accentRed },
      { token: 'type', foreground: accentOrange },
      { token: 'class', foreground: accentOrange },
      { token: 'function', foreground: accentBlue },
      { token: 'function.js', foreground: accentBlue },
      { token: 'function.ts', foreground: accentBlue },
      { token: 'function.tsx', foreground: accentBlue },
      { token: 'variable', foreground: textSecondary },
      { token: 'variable.predefined', foreground: accentRed },
      { token: 'identifier', foreground: textSecondary }
    ],
    colors: {
      'editor.background': '#121212',
      'editor.foreground': textPrimary,
      'editorLineNumber.foreground': '#4b5263',
      'editorLineNumber.activeForeground': '#c8ccd4',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.selectionBackground': '#ffffff1a',
      'editor.inactiveSelectionBackground': '#ffffff0d',
      'editorWidget.background': '#121212',
      'editorWidget.border': '#ffffff0f',
      'editorHoverWidget.background': '#121212',
      'editorHoverWidget.border': '#ffffff0f',
      'scrollbarSlider.background': '#ffffff0f',
      'scrollbarSlider.hoverBackground': '#ffffff1a',
      'scrollbarSlider.activeBackground': '#ffffff26',

      'editorOverviewRuler.border': '#00000000',
      'editorOverviewRuler.background': '#121212',
      'editorOverviewRuler.addedForeground': '#00000000',
      'editorOverviewRuler.modifiedForeground': '#00000000',
      'editorOverviewRuler.deletedForeground': '#00000000',
      'editorOverviewRuler.errorForeground': '#00000000',
      'editorOverviewRuler.warningForeground': '#00000000',
      'editorOverviewRuler.infoForeground': '#00000000',

      'editorError.foreground': '#00000000',
      'editorError.background': '#00000000',
      'editorError.border': '#00000000',
      'editorWarning.foreground': '#00000000',
      'editorWarning.background': '#00000000',
      'editorWarning.border': '#00000000',
      'editorInfo.foreground': '#00000000',
      'editorInfo.background': '#00000000',
      'editorInfo.border': '#00000000'
    }
  })
  markMonacoInitialized()
}
