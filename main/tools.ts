import { createFileTools } from './fileTools'
import { createShellTools } from './shellTools'
import { createWebTools } from './webTools'
import { browserTools } from './browserTools'

export function createCoreTools(convId: string, modelSupportsVision = true) {
  const fileTools = createFileTools(convId, modelSupportsVision)
  const shellTools = createShellTools(convId)
  const webTools = createWebTools(convId)
  return {
    ...fileTools,
    ...shellTools,
    ...webTools
  }
}

export {
  browserTools
}
