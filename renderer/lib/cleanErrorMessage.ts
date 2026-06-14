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

  if (errorStr.includes('apikey') || errorStr.includes('Invalid API Key') || errorStr.includes('Unauthorized') || errorStr.includes('Unauthenticated') || errorStr.includes('authentication failed') || errorStr.includes('API key') || errorStr.includes('401') || errorStr.includes('403')) {
    return 'Authentication failed. Your session might have expired, or the API key is invalid. Please sign out and sign back in to refresh your access.'
  }
  if (errorStr.includes('Failed to fetch') || errorStr.includes('fetch failed') || errorStr.includes('network') || errorStr.includes('connection')) {
    return 'Unable to connect to the server. Please check your network connection and try again.'
  }
  if (errorStr.includes('model_not_found') || errorStr.includes('does not exist')) {
    return 'The selected AI model is temporarily unavailable. Please select another model.'
  }
  if (errorStr.includes('BUDGET_EXCEEDED') || errorStr.includes('Monthly budget') || (errorStr.includes('budget') && errorStr.includes('reached'))) {
    return 'Monthly usage budget exhausted. Your quota resets at the start of next month. Check Settings → Usage & Cost for details.'
  }
  if (errorStr.includes('rate limit') || errorStr.includes('429') || errorStr.includes('quota') || errorStr.includes('limit reached')) {
    return 'The API rate limit or credit quota for this model has been exceeded. Please wait a minute before retrying, or switch to another model.'
  }
  if (errorStr.includes('500') || errorStr.includes('internal error') || errorStr.includes('server error') || errorStr.includes('INTERNAL')) {
    return 'The server encountered an internal error. Please try again in a few moments, or select a different model.'
  }
  if (errorStr.includes('400') || errorStr.includes('bad request') || errorStr.includes('invalid argument') || errorStr.includes('not supported')) {
    return 'The request to the model was invalid or contains unsupported parameters. If this persists, please try resetting the conversation.'
  }
  if (errorStr.includes('timeout') || errorStr.includes('504') || errorStr.includes('abort')) {
    return 'The request took too long to respond. Please try again in a few moments.'
  }
  if (errorStr.startsWith('{') && errorStr.endsWith('}')) {
    return 'An unexpected error occurred. Please try again.'
  }
  return errorStr
}
