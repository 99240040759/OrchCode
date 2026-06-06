export function createDebounce(fn: () => void, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = () => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(fn, delay)
  }
  debounced.cancel = () => { if (timeoutId) clearTimeout(timeoutId) }
  return debounced
}
