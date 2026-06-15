 
export function cleanErrorMessage(rawErr: unknown): string {
  if (!rawErr) return 'An unknown error occurred.'

  
  if (typeof rawErr === 'string' && !rawErr.startsWith('{') && !rawErr.startsWith('[')) {
    return rawErr
  }

  
  if (typeof rawErr === 'object' && rawErr !== null) {
    const e = rawErr as { message?: string; error?: string; msg?: string }
    if (typeof e.message === 'string') return cleanErrorMessage(e.message)
    if (typeof e.error   === 'string') return e.error
    if (typeof e.msg     === 'string') return e.msg
  }

  const errorStr = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr)

  
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
  } catch {   }

  
  if (errorStr.includes('BUDGET_EXCEEDED') || (errorStr.includes('budget') && errorStr.includes('reached'))) {
    return 'Monthly usage budget exhausted. Your quota resets at the start of next month. Check Settings → Usage & Cost for details.'
  }

  
  if (errorStr.includes('model output must contain') || errorStr.includes('both be empty') || errorStr.includes('output text or tool calls')) {
    return "The model didn't respond. Please try again."
  }

  return errorStr || 'An unexpected error occurred.'
}
