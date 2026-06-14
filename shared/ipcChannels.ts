export const PUSH_CHANNELS = [
  'auth:status-changed',
  'browser:title-updated',
  'browser:url-changed',
  'artifacts:changed',
  'updater:status-changed',
  'stream:worker-crashed',
  'command:new-conversation',
  'command:open-workspace',
  'shortcut:toggle-sidebar',
  'shortcut:toggle-artifacts',
  'shortcut:focus-input',
  'shortcut:toggle-terminal',
  'permissions:changed',
] as const

export type PushChannel = typeof PUSH_CHANNELS[number]
