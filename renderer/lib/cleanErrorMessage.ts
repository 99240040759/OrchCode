/**
 * Extracts a human-readable error string from an unknown error value.
 *
 * The main process (streamWorker.ts) now uses typed OpenAI SDK error classes
 * to produce clean messages before sending them to the renderer. This function
 * only needs to handle raw/dirty inputs that arrive outside that path —
 * e.g. GCP function JSON error responses, raw Error objects, or plain strings.
 * It does NOT re-pattern-match on already-clean strings.
 */
export function cleanErrorMessage(rawErr: unknown): string {
  if (!rawErr) return 'An unknown error occurred.'

  // Already a clean string from main process typed error handler — pass through.
  if (typeof rawErr === 'string' && !rawErr.startsWith('{') && !rawErr.startsWith('[')) {
    return rawErr
  }

  // Error object — extract .message and recurse
  if (typeof rawErr === 'object' && rawErr !== null) {
    const e = rawErr as { message?: string; error?: string; msg?: string }
    if (typeof e.message === 'string') return cleanErrorMessage(e.message)
    if (typeof e.error   === 'string') return e.error
    if (typeof e.msg     === 'string') return e.msg
  }

  const errorStr = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr)

  // Try to unwrap JSON-encoded API error responses (e.g. from GCP function)
  try {
    const parsed = JSON.parse(errorStr)
    if (parsed && typeof parsed === 'object') {
      const msg =
        parsed.message          ||
        parsed.error?.message   ||
        parsed.error            ||
        parsed.msg              ||
        parsed.description
      if (typeof msg === 'string' && msg.trim()) return msg.trim()
    }
  } catch { /* not JSON — fall through */ }

  // App-level budget error from our server (not an OpenAI SDK error)
  if (errorStr.includes('BUDGET_EXCEEDED') || (errorStr.includes('budget') && errorStr.includes('reached'))) {
    return 'Monthly usage budget exhausted. Your quota resets at the start of next month. Check Settings → Usage & Cost for details.'
  }

  // Empty model output — provider rejected because the model produced no content
  if (errorStr.includes('model output must contain') || errorStr.includes('both be empty') || errorStr.includes('output text or tool calls')) {
    return "The model didn't respond. Please try again."
  }

  return errorStr || 'An unexpected error occurred.'
}
