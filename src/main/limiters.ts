import Bottleneck from 'bottleneck'

// One active stream at a time — no artificial delay between requests
export const chatStreamLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 0
})

// Tavily web search — moderate rate limit
export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500
})

// Per-provider fetch limiters — 10s gap between calls to avoid rate-limit 429s
// Title generation and summarisation bypass these via googleBypass client
export const geminiLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

export const nvidiaLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})
