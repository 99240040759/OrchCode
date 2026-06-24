import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import fs from 'fs';
const env = { ...loadEnv('', process.cwd(), ''), ...process.env };
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GCP_FUNCTIONS_URL', 'SENTRY_DSN'];
if (env.CI) { for (const k of required) if (!env[k]) throw new Error(`Missing required env var: ${k}`); }
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src'), 'tslib': path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js') } },
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(env.SENTRY_DSN),
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
  },
  plugins: [{
    name: 'copy-skills',
    closeBundle() {
      const s = path.resolve(__dirname, 'src/agent/skills'), d = path.resolve(__dirname, '.vite/build/skills');
      if (fs.existsSync(s)) { fs.mkdirSync(d, { recursive: true }); fs.readdirSync(s).forEach(f => fs.copyFileSync(path.join(s, f), path.join(d, f))); }
    }
  }],
  build: { rollupOptions: { external: ['electron', 'better-sqlite3', 'node-pty', '@vscode/ripgrep'] } },
});
