import Bottleneck from 'bottleneck'

export const chatStreamLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000
})

export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 500
})
