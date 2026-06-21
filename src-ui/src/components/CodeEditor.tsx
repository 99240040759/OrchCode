import { onMount, onCleanup, createEffect } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { vue } from '@codemirror/lang-vue';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';
import { oneDark } from '@codemirror/theme-one-dark';
import { colors } from '../theme';

function getLang(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': case 'tsx': return javascript({ typescript: true, jsx: ext === 'tsx' });
    case 'js': case 'jsx': case 'mjs': case 'cjs': return javascript({ jsx: ext === 'jsx' });
    case 'py': case 'pyw': case 'pyi': return python();
    case 'css': case 'scss': case 'less': return css();
    case 'html': case 'htm': case 'ejs': return html();
    case 'vue': return vue();
    case 'svelte': return html();
    case 'xml': case 'svg': case 'xhtml': case 'xaml': case 'plist': return xml();
    case 'php': return php();
    case 'rs': return rust();
    case 'c': case 'h': case 'cpp': case 'cc': case 'cxx': case 'hpp': return cpp();
    case 'java': return java();
    case 'json': case 'jsonc': case 'json5': return json();
    case 'yaml': case 'yml': return yaml();
    case 'sql': case 'psql': case 'mysql': return sql();
    case 'md': case 'mdx': case 'mdoc': return markdown();
    default: return null;
  }
}

async function getLegacyLang(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  try {
    switch (ext) {
      case 'go': { const { go } = await import('@codemirror/legacy-modes/mode/go'); return StreamLanguage.define(go); }
      case 'kt': case 'kts': { const { kotlin } = await import('@codemirror/legacy-modes/mode/clike'); return StreamLanguage.define(kotlin); }
      case 'dart': { const { dart } = await import('@codemirror/legacy-modes/mode/clike'); return StreamLanguage.define(dart); }
      case 'swift': { const { swift } = await import('@codemirror/legacy-modes/mode/swift'); return StreamLanguage.define(swift); }
      case 'rb': case 'rake': case 'gemspec': { const { ruby } = await import('@codemirror/legacy-modes/mode/ruby'); return StreamLanguage.define(ruby); }
      case 'sh': case 'bash': case 'zsh': case 'fish': { const { shell } = await import('@codemirror/legacy-modes/mode/shell'); return StreamLanguage.define(shell); }
      case 'ps1': case 'psm1': { const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell'); return StreamLanguage.define(powerShell); }
      case 'toml': { const { toml } = await import('@codemirror/legacy-modes/mode/toml'); return StreamLanguage.define(toml); }
      case 'lua': { const { lua } = await import('@codemirror/legacy-modes/mode/lua'); return StreamLanguage.define(lua); }
      case 'r': case 'rmd': { const { r } = await import('@codemirror/legacy-modes/mode/r'); return StreamLanguage.define(r); }
      case 'dockerfile': { const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile'); return StreamLanguage.define(dockerFile); }
      case 'nginx': { const { nginx } = await import('@codemirror/legacy-modes/mode/nginx'); return StreamLanguage.define(nginx); }
      case 'cs': { const { csharp } = await import('@codemirror/legacy-modes/mode/clike'); return StreamLanguage.define(csharp); }
      default: return null;
    }
  } catch { return null; }
}

function darkTheme() {
  return EditorView.theme({
    '&': { height:'100%', fontSize:'13px', fontFamily:"'JetBrains Mono','Fira Code',monospace", background: colors.pageDark },
    '&.cm-focused': { outline:'none' },
    '.cm-scroller': { overflow:'auto', lineHeight:'1.6' },
    '.cm-content': { caretColor: colors.creamDark, padding:'8px 0' },
    '.cm-gutters': { background: colors.surfaceDark, border:'none', color: colors.textFaintDark, minWidth:'44px' },
    '.cm-activeLineGutter': { background:'rgba(239,227,210,0.05)' },
    '.cm-activeLine': { background:'rgba(239,227,210,0.04)' },
    '.cm-selectionBackground, ::selection': { background:'rgba(239,227,210,0.15) !important' },
    '.cm-focused .cm-selectionBackground': { background:'rgba(239,227,210,0.18) !important' },
    '.cm-cursor,.cm-dropCursor': { borderLeftColor: colors.creamDark },
    '.cm-matchingBracket': { background:'rgba(239,227,210,0.15)', color:'inherit !important', outline:'none' },
    '.cm-nonmatchingBracket': { background:'rgba(239,68,68,0.15)', color:'inherit !important' },
    '.cm-searchMatch': { background:'rgba(239,227,210,0.12)', outline:'none' },
    '.cm-searchMatch.cm-searchMatch-selected': { background:'rgba(239,227,210,0.25)' },
    '.cm-selectionMatch': { background:'rgba(239,227,210,0.1)' },
    '.cm-tooltip': { background: colors.surfaceElevatedDark, border:`1px solid ${colors.borderDark}` },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: colors.surface2Dark },
  }, { dark: true });
}

function lightTheme() {
  return EditorView.theme({
    '&': { height:'100%', fontSize:'13px', fontFamily:"'JetBrains Mono','Fira Code',monospace", background: colors.pageLight },
    '&.cm-focused': { outline:'none' },
    '.cm-scroller': { overflow:'auto', lineHeight:'1.6' },
    '.cm-content': { caretColor: colors.cream, padding:'8px 0' },
    '.cm-gutters': { background: colors.surfaceLight, border:'none', color: colors.textFaintLight, borderRight:`1px solid ${colors.borderLight}`, minWidth:'44px' },
    '.cm-activeLineGutter': { background:'rgba(0,0,0,0.04)' },
    '.cm-activeLine': { background:'rgba(0,0,0,0.03)' },
    '.cm-selectionBackground, ::selection': { background:'rgba(0,0,0,0.1) !important' },
    '.cm-focused .cm-selectionBackground': { background:'rgba(0,0,0,0.12) !important' },
    '.cm-cursor,.cm-dropCursor': { borderLeftColor: colors.cream },
    '.cm-matchingBracket': { background:'rgba(191,174,152,0.2)', color:'inherit !important', outline:'none' },
    '.cm-nonmatchingBracket': { background:'rgba(220,38,38,0.1)', color:'inherit !important' },
    '.cm-searchMatch': { background:'rgba(191,174,152,0.2)', outline:'none' },
    '.cm-searchMatch.cm-searchMatch-selected': { background:'rgba(191,174,152,0.4)' },
    '.cm-selectionMatch': { background:'rgba(191,174,152,0.15)' },
    '.cm-tooltip': { background: colors.surfaceLight, border:`1px solid ${colors.borderLight}` },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: colors.surfaceElevatedLight },
    '.tok-keyword': { color:'#7c3aed', fontWeight:'600' },
    '.tok-comment': { color: colors.textFaintLight, fontStyle:'italic' },
    '.tok-string': { color:'#059669' },
    '.tok-number': { color:'#d97706' },
    '.tok-typeName,.tok-className': { color:'#1d4ed8' },
    '.tok-function,.tok-variableName': { color:'#374151' },
    '.tok-operator': { color:'#6d28d9' },
    '.tok-punctuation': { color:'#6b7280' },
    '.tok-bool,.tok-null': { color:'#7c3aed' },
    '.tok-tagName': { color:'#be123c' },
    '.tok-attributeName': { color:'#1d4ed8' },
    '.tok-attributeValue': { color:'#059669' },
    '.tok-propertyName': { color:'#0369a1' },
  }, { dark: false });
}

interface Props { content: string; filePath: string; dark: boolean; }

export default function CodeEditor(props: Props) {
  let el!: HTMLDivElement;
  let view: EditorView | null = null;
  // M8: track mount state to avoid setState after unmount
  let mounted = true;

  onMount(async () => {
    const lang = getLang(props.filePath) ?? await getLegacyLang(props.filePath);
    if (!mounted) return;
    view = new EditorView({ state: buildState(props.content, props.dark, lang), parent: el });
  });
  onCleanup(() => { mounted = false; view?.destroy(); });

  // M8: use sync createEffect with a separate async update function
  createEffect(() => {
    const content = props.content; const dark = props.dark; const path = props.filePath;
    if (!view) return;
    (async () => {
      const lang = getLang(path) ?? await getLegacyLang(path);
      if (view && mounted) view.setState(buildState(content, dark, lang));
    })();
  });

  return <div ref={el} class="code-editor"/>;
}

function buildState(content: string, dark: boolean, lang: any) {
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      ...(dark ? [oneDark, darkTheme()] : [lightTheme()]),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      ...(lang ? [lang] : []),
    ],
  });
}
