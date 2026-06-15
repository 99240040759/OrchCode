import { getToolPermissions, setToolPermission as dbSetToolPermission } from './db'

export type PermissionLevel = 'always_allow' | 'always_ask' | 'always_deny'

const DEFAULT_PERMISSIONS: Record<string, PermissionLevel> = {
  run_command: 'always_ask',   
}

let permissionCache: Record<string, PermissionLevel> | null = null

export function invalidatePermissionCache() { permissionCache = null }

async function getAllPermissions(): Promise<Record<string, PermissionLevel>> {
  if (permissionCache) return { ...permissionCache }
  const overrides = await getToolPermissions()
  const merged = { ...DEFAULT_PERMISSIONS }
  for (const { tool_name, permission } of overrides) merged[tool_name] = permission as PermissionLevel
  permissionCache = merged
  return { ...merged }
}

export async function getToolPermission(toolName: string): Promise<PermissionLevel> {
  const all = await getAllPermissions()
  return all[toolName] ?? 'always_allow'  
}

export async function setPermission(toolName: string, permission: PermissionLevel): Promise<void> {
  await dbSetToolPermission(toolName, permission)
  invalidatePermissionCache()
}


export interface ApprovalResponse { approved: boolean; remember?: boolean }
