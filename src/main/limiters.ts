import Bottleneck from 'bottleneck'

// Throttles agent stream requests — one at a time with 10s minimum gap
export const chatStreamLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

// Throttles Tavily search tool requests to avoid external rate limits
export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

// Throttles Gemini (Google) API fetch requests through the Supabase edge function
export const geminiLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

// Throttles NVIDIA NIM API fetch requests through the Supabase edge function
// Kept separate from geminiLimiter so Gemini and NVIDIA queues don't block each other
export const nvidiaLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})
