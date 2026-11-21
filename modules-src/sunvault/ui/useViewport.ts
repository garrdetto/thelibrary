import { useEffect, useState } from 'react'

export type LayoutMode = 'wide' | 'phone' | 'short'

const SHORT_QUERY = '(orientation: landscape) and (max-height: 520px)'
const PHONE_QUERY = '(max-width: 639px), (orientation: portrait) and (max-width: 1023px) and (pointer: coarse)'
const TOUCH_QUERY = '(pointer: coarse)'

const matches = (query: string): boolean => typeof window.matchMedia === 'function' && window.matchMedia(query).matches

function readMode(): LayoutMode {
  if (matches(SHORT_QUERY)) return 'short'
  if (matches(PHONE_QUERY)) return 'phone'
  return 'wide'
}

function useMediaState<T>(queries: readonly string[], read: () => T): T {
  const [value, setValue] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const lists = queries.map((query) => window.matchMedia(query))
    const update = () => setValue(read())
    for (const list of lists) list.addEventListener('change', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      for (const list of lists) list.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [queries, read])
  return value
}

const MODE_QUERIES = [SHORT_QUERY, PHONE_QUERY] as const
const TOUCH_QUERIES = [TOUCH_QUERY] as const
const readTouch = () => matches(TOUCH_QUERY)

export function useLayoutMode(): LayoutMode {
  return useMediaState(MODE_QUERIES, readMode)
}

export function useTouchInput(): boolean {
  return useMediaState(TOUCH_QUERIES, readTouch)
}
