import Bottleneck from 'bottleneck'

// Throttles agent stream requests to prevent concurrent streams in the desktop app
export const chatStreamLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

// Throttles Tavily search tool requests to avoid rate limits
export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

// Throttles Gemini API fetch requests to protect the edge function without deadlocking
export const geminiLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})


