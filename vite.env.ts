import { loadEnv } from 'vite';
export function validateEnv() {
  const env = { ...loadEnv('', process.cwd(), ''), ...process.env };
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GCP_FUNCTIONS_URL', 'SENTRY_DSN'];
  if (env.CI) { for (const k of required) if (!env[k]) throw new Error(`Missing required env var: ${k}`); }
  return env;
}
