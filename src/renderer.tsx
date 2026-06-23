import * as Sentry from '@sentry/electron/renderer';
Sentry.init({});
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
const c = document.getElementById('root');
if (!c) throw new Error('Root missing');
createRoot(c).render(<React.StrictMode><App /></React.StrictMode>);
