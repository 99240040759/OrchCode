import * as Sentry from '@sentry/electron/renderer';
Sentry.init({});
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import('monaco-editor').then(m => loader.config({ monaco: m }));
import App from './App';
import './index.css';
const c = document.getElementById('root');
if (!c) throw new Error('Root missing');
createRoot(c).render(<StrictMode><App /></StrictMode>);

