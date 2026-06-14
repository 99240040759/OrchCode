import { getToolPermissions, setToolPermission as dbSetToolPermission } from './db'

export type PermissionLevel = 'always_allow' | 'always_ask' | 'always_deny'

const DEFAULT_PERMISSIONS: Record<string, PermissionLevel> = {
  list_dir: 'always_allow',
  view_file: 'always_allow',
  search_workspace: 'always_allow',
  search_web: 'always_allow',
  write_to_file: 'always_ask',
  multi_replace_file_content: 'always_ask',
  run_command: 'always_ask',
  generate_image: 'always_ask',
  save_memory: 'always_allow',
  browser_navigate: 'always_allow',
  browser_screenshot: 'always_allow',
  browser_click: 'always_allow',
  browser_type: 'always_allow',
  browser_keyboard_press: 'always_allow',
  browser_get_page_content: 'always_allow',
}

let permissionCache: Record<string, PermissionLevel> | null = null

export function invalidatePermissionCache() { permissionCache = null }

export async function getAllPermissions(): Promise<Record<string, PermissionLevel>> {
  if (permissionCache) return { ...permissionCache }
  const overrides = await getToolPermissions()
  const merged = { ...DEFAULT_PERMISSIONS }
  for (const { tool_name, permission } of overrides) merged[tool_name] = permission as PermissionLevel
  permissionCache = merged
  return { ...merged }
}

export async function getToolPermission(toolName: string): Promise<PermissionLevel> {
  const all = await getAllPermissions()
  return all[toolName] ?? 'always_ask'
}

export async function setPermission(toolName: string, permission: PermissionLevel): Promise<void> {
  await dbSetToolPermission(toolName, permission)
  invalidatePermissionCache()
}

export function getDefaultPermissions(): Record<string, PermissionLevel> {
  return { ...DEFAULT_PERMISSIONS }
}

export interface ApprovalResponse { approved: boolean; remember?: boolean }
