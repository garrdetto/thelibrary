import { useEffect, useState } from 'react'

export const PHONE_TOUCH_QUERY = '(pointer: coarse) and (max-width: 650px), (pointer: coarse) and (max-height: 500px)'

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}
