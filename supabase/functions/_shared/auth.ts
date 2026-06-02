/**
 * Shared Supabase auth validation for edge functions.
 * 
 * CRIT-4 FIX: The old isValidLegacyJWT() decoded the JWT payload but NEVER
 * checked the cryptographic signature — trivially bypassable by forging a JWT.
 * 
 * Resolution: A Supabase anon key IS a JWT, but for edge-function auth the correct
 * approach is simple constant-time string equality against the known anon key value.
 * JWT signature verification requires the Supabase JWT secret (not available server-side
 * without additional env setup). We remove the misleading JWT parsing entirely and
 * only do direct key comparison with timing-safe equality.
 */

/** Timing-safe string comparison to prevent timing attacks on key comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Validates the bearer token or apikey header against the expected anon key.
 * Uses timing-safe comparison to prevent timing side-channel attacks.
 * 
 * NOTE: isValidLegacyJWT removed — it decoded JWT payload without verifying
 * the signature, giving false sense of security. Direct key comparison is correct.
 */
export function validateAnonKey(
  req: Request,
  expectedAnonKey: string,
  _projectRef?: string
): boolean {
  const authHeader = req.headers.get('Authorization')
  const apiKeyHeader = req.headers.get('apikey')

  let token = ''
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  } else if (apiKeyHeader) {
    token = apiKeyHeader
  }

  if (!token) return false
  return timingSafeEqual(token, expectedAnonKey)
}
