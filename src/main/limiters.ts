import Bottleneck from 'bottleneck'



// Tavily web search — moderate rate limit
export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500
})

// Unified global API limiter — 10s gap between ANY provider calls to avoid rate-limit 429s globally
// Title generation and summarisation bypass this via googleBypass client
export const globalApiLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})
