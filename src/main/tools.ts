import { createFileTools } from './tools/fileTools'
import { createShellTools } from './tools/shellTools'
import { createWebTools } from './tools/webTools'
import { browserTools, startBrowserAgentWorker, stopBrowserAgentWorker } from './tools/browserTools'

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
  browserTools,
  startBrowserAgentWorker,
  stopBrowserAgentWorker
}
