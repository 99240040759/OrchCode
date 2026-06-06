import { tool } from 'ai'
import { z } from 'zod'
import log from 'electron-log'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tavilyLimiter } from './limiters'
import { getWorkspaceContext, assertWithinWorkspace, invalidateWorkspaceFilesCache } from './workspace'
import { getCurrentSession } from './auth'

export function createWebTools(convId?: string) {
  const searchWeb = tool({
    description:
      'Search the web using the Tavily API and return a summary of relevant results with URL citations.',
    inputSchema: z.object({
      query: z.string().describe('The search query.'),
      domain: z.string().optional().describe('Optional domain to prioritize in results.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe('Max number of results (1–10, default 5).')
    }),
    execute: async ({ query, domain, maxResults }) => {
      return tavilyLimiter.schedule(async () => {
        log.info(`[tool:searchWeb] query="${query}" domain=${domain ?? 'any'}`)
        try {
          const session = getCurrentSession()
          const token = session?.idToken
          if (!token) throw new Error('Unauthenticated user. Please sign in to search the web.')
          const anonKey = process.env.SUPABASE_ANON_KEY
          if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')

          const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/tavily`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: anonKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, domain, maxResults })
          })
          if (!response.ok) throw new Error(`Proxy error: HTTP ${response.status}`)
          const data = await response.json()
          const results = (data.results ?? []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: r.score
          }))
          return { query, answer: data.answer ?? null, results, totalResults: results.length }
        } catch (err: any) {
          log.error('[tool:searchWeb] Tavily error:', err.message)
          return { success: false, error: `Web search failed: ${err.message}` }
        }
      })
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : `Answer: ${output.answer || 'N/A'}\nResults:\n${JSON.stringify(output.results, null, 2)}` }] })
  })

  const generateImage = tool({
    description:
      'Generate an image based on a prompt using the FLUX.2-klein-4b model and save it to the workspace.',
    inputSchema: z.object({
      prompt: z.string().describe('The detailed text prompt describing the image to generate.'),
      width: z
        .number()
        .int()
        .min(256)
        .max(1440)
        .optional()
        .default(1024)
        .describe('Image width in pixels (default: 1024).'),
      height: z
        .number()
        .int()
        .min(256)
        .max(1440)
        .optional()
        .default(1024)
        .describe('Image height in pixels (default: 1024).'),
      seed: z.number().int().optional().default(0).describe('Seed for deterministic generation.'),
      steps: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(4)
        .describe('Denoising steps (1-50, default: 4).')
    }),
    execute: async ({ prompt, width, height, seed, steps }) => {
      log.info(
        `[tool:generateImage] prompt="${prompt}" size=${width}x${height} seed=${seed} steps=${steps}`
      )
      try {
        if (!convId) {
          throw new Error('No active conversation ID provided. Image generation cannot resolve workspace.')
        }

        const session = getCurrentSession()
        const token = session?.idToken
        if (!token) throw new Error('Unauthenticated user. Please sign in to generate images.')
        const anonKey = process.env.SUPABASE_ANON_KEY
        if (!anonKey) throw new Error('SUPABASE_ANON_KEY configuration is missing.')

        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-image`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prompt, width, height, seed, steps })
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Proxy error (HTTP ${response.status}): ${errText}`)
        }

        const data = await response.json()

        // Find base64 image data in response payload
        let base64Data: string | undefined
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const item = data.data[0]
          if (item.b64_json) {
            base64Data = item.b64_json
          } else if (item.url) {
            // Fetch URL content to extract base64 representation
            const imgRes = await fetch(item.url)
            if (imgRes.ok) {
              const buf = await imgRes.arrayBuffer()
              base64Data = Buffer.from(buf).toString('base64')
            }
          }
        }

        if (
          !base64Data &&
          data.artifacts &&
          Array.isArray(data.artifacts) &&
          data.artifacts.length > 0
        ) {
          const item = data.artifacts[0]
          if (item.base64) {
            base64Data = item.base64
          }
        }

        if (!base64Data) {
          throw new Error(`No image data returned in API response: ${JSON.stringify(data)}`)
        }

        // Get workspace path
        const ctx = getWorkspaceContext(convId)
        if (!ctx) {
          throw new Error(`Workspace context not found for conversation: ${convId}`)
        }

        const rootPath = ctx.rootPath
        const folderPath = join(rootPath, 'generated-images')
        const fileName = `img-${Date.now()}.png`
        const targetPath = join(folderPath, fileName)

        // Prevent directory traversal
        assertWithinWorkspace(rootPath, targetPath, convId)

        // Ensure folder exists and write the image file
        await fs.mkdir(folderPath, { recursive: true })
        await fs.writeFile(targetPath, Buffer.from(base64Data, 'base64'))

        // Invalidate workspace cache to make sure UI is immediately aware
        invalidateWorkspaceFilesCache(rootPath)

        log.info(`[tool:generateImage] saved image to ${targetPath}`)
        return {
          success: true,
          filePath: targetPath,
          message: `Image generated successfully and saved to ${targetPath}`
        }
      } catch (err: any) {
        log.error('[tool:generateImage] Error:', err.message)
        return { success: false, error: `Image generation failed: ${err.message}` }
      }
    },
    toModelOutput: ({ output }: any) => ({ type: 'content', value: [{ type: 'text', text: output.success === false ? `Error: ${output.error}` : output.message }] })
  })

  return {
    searchWeb,
    generateImage
  }
}
