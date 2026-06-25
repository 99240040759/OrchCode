import { defineConfig } from 'vite';
import { validateEnv } from './vite.env';
const env = validateEnv();
export default defineConfig({
  define: {
    'process.env.GCP_FUNCTIONS_URL': JSON.stringify(env.GCP_FUNCTIONS_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
  },
  build: { rollupOptions: { onwarn(warning: any, warn: any) { if (warning.code === 'DEPRECATED_FEATURE' && warning.message.includes('inlineDynamicImports')) return; warn(warning); } } },
});
