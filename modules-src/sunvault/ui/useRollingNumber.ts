import { useEffect, useRef, useState } from 'react'

export function useRollingNumber(target: number, duration = 0.9): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  useEffect(() => {
    if (target <= shownRef.current) {
      shownRef.current = target
      setShown(target)
      return
    }
    const from = shownRef.current
    const started = performance.now()
    const span = Math.min(3, duration + Math.log10(1 + (target - from) / 1000) * 0.4)
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / (span * 1000))
      const eased = 1 - Math.pow(1 - t, 3)
      const value = Math.round(from + (target - from) * eased)
      shownRef.current = value
      setShown(value)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return shown
}
