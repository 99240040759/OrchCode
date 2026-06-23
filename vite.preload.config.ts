import { defineConfig, loadEnv } from 'vite';
const env = { ...loadEnv('', process.cwd(), ''), ...process.env };
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GCP_FUNCTIONS_URL', 'SENTRY_DSN'];
if (env.CI) { for (const k of required) if (!env[k]) throw new Error(`Missing required env var: ${k}`); }
export default defineConfig({
  define: {
    'process.env.GCP_FUNCTIONS_URL': JSON.stringify(env.GCP_FUNCTIONS_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
  },
  build: { rollupOptions: { onwarn(warning: any, warn: any) { if (warning.code === 'DEPRECATED_FEATURE' && warning.message.includes('inlineDynamicImports')) return; warn(warning); } } },
});
