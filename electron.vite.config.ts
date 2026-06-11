import 'dotenv/config'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
  throw new Error('Build failed: SUPABASE_URL environment variable is missing for production build.')
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty', 'playwright-core'],
        input: {
          index: resolve(__dirname, 'main/main.ts'),
          agentWorker: resolve(__dirname, 'main/agentWorker.ts'),
          ptyWorker: resolve(__dirname, 'main/ptyWorker.ts'),
          dbWorker: resolve(__dirname, 'main/dbWorker.ts'),
          db: resolve(__dirname, 'main/db.ts')
        }
      }
    },
    define: {
      'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY),
      'process.env.GCP_FUNCTIONS_URL': JSON.stringify(process.env.GCP_FUNCTIONS_URL)
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('renderer')
      }
    },
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', { target: '19' }]]
        }
      })
    ]
  }
})
