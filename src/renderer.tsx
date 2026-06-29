import * as Sentry from '@sentry/electron/renderer';
Sentry.init({});
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import('monaco-editor').then(m => {
  loader.config({ monaco: m });
  m.editor.defineTheme('orchTheme', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '8a7560', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c08bb0' },
      { token: 'storage', foreground: 'c08bb0' },
      { token: 'string', foreground: '9caa6b' },
      { token: 'number', foreground: 'e08a5f' },
      { token: 'constant', foreground: 'e08a5f' },
      { token: 'type', foreground: 'd9b88a' },
      { token: 'function', foreground: '7fa0b8' },
      { token: 'variable', foreground: 'f0e0cf' },
      { token: 'delimiter', foreground: 'b8a692' },
    ],
    colors: {
      'editor.background': '#1c1714', 'editor.lineHighlightBackground': '#241c17',
      'editorLineNumber.foreground': '#f7ede233', 'editorLineNumber.activeForeground': '#f7ede2b3',
      'editor.selectionBackground': '#d07a5240', 'editor.findMatchBackground': '#d07a5266',
      'editor.findMatchHighlightBackground': '#d07a5233',
      'editor.border': '#ffe4cd17', 'scrollbarSlider.background': '#d07a5238',
      'scrollbarSlider.hoverBackground': '#d07a5266', 'scrollbarSlider.activeBackground': '#d07a5266',
      'diffEditor.insertedTextBackground': '#9caa6b22', 'diffEditor.removedTextBackground': '#cf5a4422'
    }
  });
});
import App from './App';
import './index.css';
const c = document.getElementById('root');
if (!c) throw new Error('Root missing');
createRoot(c).render(<StrictMode><App /></StrictMode>);

