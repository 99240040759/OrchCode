import * as Sentry from '@sentry/electron/renderer';
Sentry.init({});
import React from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
loader.config({ monaco });
import App from './App';
import './index.css';
const c = document.getElementById('root');
if (!c) throw new Error('Root missing');
createRoot(c).render(<React.StrictMode><App /></React.StrictMode>);

