import Bottleneck from 'bottleneck'

export const chatStreamLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

export const tavilyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

export const geminiLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})

export const nvidiaLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 10000
})
