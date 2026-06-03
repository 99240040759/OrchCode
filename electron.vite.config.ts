import 'dotenv/config'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin'

// Ensure critical environment variables are present during build
if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
  console.warn(
    '\n\x1b[33m%s\x1b[0m',
    '⚠️ WARNING: SUPABASE_URL is not set during build. The packaged app will crash when fetching models!'
  )
  console.warn(
    '\x1b[33m%s\x1b[0m',
    'If building locally, ensure you have a .env file with your secrets.'
  )
  console.warn(
    '\x1b[33m%s\x1b[0m',
    'If using GitHub Actions, ensure the secret is added to "Repository secrets", not "Environment secrets".\n'
  )
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty', 'playwright-core'],
        input: {
          index: resolve(__dirname, 'src/main/main.ts'),
          browserWorker: resolve(__dirname, 'src/main/browserWorker.ts')
        }
      }
    },
    define: {
      'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
      'process.env.FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY),
      'process.env.GA4_MEASUREMENT_ID': JSON.stringify(process.env.GA4_MEASUREMENT_ID),
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID),
      // CRIT-6: GOOGLE_CLIENT_SECRET intentionally removed — PKCE flow does not need a
      // client secret. Baking it into the distributable allows trivial extraction from
      // the shipped JS. auth.ts already uses PKCE (generatePKCE()) without needing it.
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
      }),
      vanillaExtractPlugin()
    ],
    define: {
      'process.env.GA4_MEASUREMENT_ID': JSON.stringify(process.env.GA4_MEASUREMENT_ID)
    }
  }
})
