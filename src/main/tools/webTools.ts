import { tool } from 'ai'
import { z } from 'zod'
import log from 'electron-log'
import { tavilyLimiter } from '../limiters'

export function createWebTools() {
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
          const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/tavily`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
              apikey: process.env.SUPABASE_ANON_KEY || '',
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
          log.error('[tool:searchWeb] Tavily error:', err)
          return { success: false, error: `Web search failed: ${err.message}` }
        }
      })
    }
  })

  return {
    searchWeb
  }
}
