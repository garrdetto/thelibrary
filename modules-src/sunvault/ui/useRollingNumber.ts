import { useEffect, useRef, useState } from 'react'

const calm = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useRollingNumber(target: number, duration = 0.9, from = 0): number {
  const start = Math.min(from, target)
  const [shown, setShown] = useState(start)
  const shownRef = useRef(start)
  useEffect(() => {
    if (target <= shownRef.current || calm()) {
      shownRef.current = target
      setShown(target)
      return
    }
    const origin = shownRef.current
    const started = performance.now()
    const span = Math.min(3, duration + Math.log10(1 + (target - origin) / 1000) * 0.4)
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / (span * 1000))
      const eased = 1 - Math.pow(1 - t, 3)
      const value = Math.round(origin + (target - origin) * eased)
      shownRef.current = value
      setShown(value)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return shown
}
