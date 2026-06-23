import { defineConfig } from 'vite';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { rollupOptions: { external: ['better-sqlite3', 'node-pty', 'electron', '@sentry/electron', '@supabase/supabase-js', 'openai', 'js-tiktoken', '@vscode/ripgrep', 'keytar'] } },
});
