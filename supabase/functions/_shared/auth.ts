/**
 * Shared Supabase auth validation for edge functions.
 * Single source of truth — imported by all three edge functions.
 */

/** Validates the legacy Supabase anon JWT format (iss=supabase, ref=projectRef, role=anon). */
export function isValidLegacyJWT(token: string, projectRef: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    return payload.iss === 'supabase' && payload.ref === projectRef && payload.role === 'anon'
  } catch {
    return false
  }
}

/** Extracts and validates the bearer token or apikey header against the expected anon key. */
export function validateAnonKey(
  req: Request,
  expectedAnonKey: string,
  projectRef: string
): boolean {
  const authHeader = req.headers.get('Authorization')
  const apiKeyHeader = req.headers.get('apikey')

  let token = ''
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  } else if (apiKeyHeader) {
    token = apiKeyHeader
  }

  return token === expectedAnonKey || (!!projectRef && isValidLegacyJWT(token, projectRef))
}
