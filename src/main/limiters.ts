import Bottleneck from 'bottleneck'

const globalLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

export const chatStreamLimiter = globalLimiter
export const tavilyLimiter = globalLimiter
