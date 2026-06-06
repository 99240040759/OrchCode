export function cleanErrorMessage(rawErr: unknown): string {
  if (!rawErr) return 'An unknown error occurred while processing the request.'

  // If it's an object, extract message directly
  if (typeof rawErr === 'object' && rawErr !== null) {
    const e = rawErr as { message?: string; error?: string; msg?: string }
    if (typeof e.message === 'string') return cleanErrorMessage(e.message)
    if (typeof e.error === 'string') return e.error
    if (typeof e.msg === 'string') return e.msg
  }

  const errorStr = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr)

  // Try JSON parse for nested error objects
  if (typeof rawErr === 'string') {
    try {
      const parsed = JSON.parse(rawErr)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.message === 'string') return parsed.message
        if (typeof parsed.error === 'string') return parsed.error
        if (parsed.error?.message) return parsed.error.message
        if (typeof parsed.msg === 'string') return parsed.msg
        if (typeof parsed.description === 'string') return parsed.description
      }
    } catch {
      // not json, fall through
    }
  }

  if (
    errorStr.includes('apikey') ||
    errorStr.includes('Invalid API Key') ||
    errorStr.includes('Unauthorized') ||
    errorStr.includes('auth') ||
    errorStr.includes('API key')
  ) {
    return 'Authentication failed. Please check your account settings or sign in again.'
  }
  if (errorStr.includes('Failed to fetch') || errorStr.includes('fetch failed')) {
    return 'Unable to connect to the server. Please check your network connection and try again.'
  }
  if (errorStr.includes('model_not_found') || errorStr.includes('does not exist')) {
    return 'The selected AI model is temporarily unavailable. Please select another model.'
  }
  if (errorStr.includes('rate limit') || errorStr.includes('429')) {
    return 'Request limit reached. Please wait a moment before trying again.'
  }
  if (errorStr.includes('timeout') || errorStr.includes('504')) {
    return 'The request took too long to respond. Please try again in a few moments.'
  }

  // If it looks like a raw JSON blob, give a generic message
  if (errorStr.startsWith('{') && errorStr.endsWith('}')) {
    return 'An unexpected error occurred. Please try again.'
  }

  return errorStr
}
