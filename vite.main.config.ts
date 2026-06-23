import { defineConfig } from 'vite';
import path from 'path';
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GCP_FUNCTIONS_URL', 'SENTRY_DSN'];
if (process.env.CI) { for (const k of required) if (!process.env[k]) throw new Error(`Missing required env var: ${k}`); }
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY),
  },
  build: { rollupOptions: { external: ['better-sqlite3', 'node-pty', 'electron', '@sentry/electron', '@supabase/supabase-js', 'openai', 'js-tiktoken', '@vscode/ripgrep', 'keytar'] } },
});
