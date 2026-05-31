import 'dotenv/config'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty', 'playwright'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          browserWorker: resolve(__dirname, 'src/main/browserWorker.ts')
        }
      }
    },
    define: {
      'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
      'process.env.FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY),
      'process.env.GA4_MEASUREMENT_ID': JSON.stringify(process.env.GA4_MEASUREMENT_ID),
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID),
      'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(process.env.GOOGLE_CLIENT_SECRET),
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY)
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', { target: '19' }]]
        }
      })
    ],
    define: {
      'process.env.GA4_MEASUREMENT_ID': JSON.stringify(process.env.GA4_MEASUREMENT_ID)
    }
  }
})
