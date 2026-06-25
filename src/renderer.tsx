import * as Sentry from '@sentry/electron/renderer';
Sentry.init({});
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import('monaco-editor').then(m => {
  loader.config({ monaco: m });
  m.editor.defineTheme('orchTheme', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': '#0c0c0e', 'editor.lineHighlightBackground': '#111113',
      'editorLineNumber.foreground': '#ffffff4d', 'editorLineNumber.activeForeground': '#ffffffb3',
      'editor.border': '#ffffff14', 'scrollbarSlider.background': '#ffffff2e',
      'scrollbarSlider.hoverBackground': '#ffffff4d', 'scrollbarSlider.activeBackground': '#ffffff4d'
    }
  });
});
import App from './App';
import './index.css';
const c = document.getElementById('root');
if (!c) throw new Error('Root missing');
createRoot(c).render(<StrictMode><App /></StrictMode>);

