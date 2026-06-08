import debounce from 'lodash.debounce'
export const createDebounce = (fn: () => void, delay: number) => debounce(fn, delay)
