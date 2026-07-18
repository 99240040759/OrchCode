import { resolve } from 'path'
import { existsSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
const envPath = resolve(__dirname, '.env')
if (existsSync(envPath)) {
  dotenv.config({ path: envPath })
}
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['bufferutil', 'utf-8-validate'],
        input: {
          index: resolve(__dirname, 'main/index.ts')
        }
      }
    },
    define: {
      'process.env.GCP_FUNCTIONS_URL': JSON.stringify(process.env.GCP_FUNCTIONS_URL ?? ''),
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL ?? ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ''),
      'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? '')
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html'),
        output: {
          manualChunks(id) {
            if (id.includes('react-syntax-highlighter')) return 'syntax-highlighter'
            if (id.includes('react-arborist')) return 'file-tree'
            if (id.includes('@sentry')) return 'telemetry'
            return undefined
          }
        }
      }
    },
    define: {
      'import.meta.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? '')
    },
    resolve: {
      alias: {
        '@': resolve('renderer')
      }
    },
    plugins: [react()]
  }
})
