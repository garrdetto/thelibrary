import { useEffect } from 'react'

const baseIcon = '<rect width="40" height="40" rx="11" fill="#48664f"/><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 28v-8.5M6.5 21.5c0-3.2 5-3.2 5 0V28M11.5 21.5c0-3.2 5-3.2 5 0V28" stroke="#b9cbb6" stroke-width="2.1"/><path d="M19.5 12 23 28l3.5-11L30 28l3.5-16" stroke="#f8faf3" stroke-width="2.3"/></g>'
const alertDot = '<circle cx="31" cy="9" r="8.5" fill="#ff4f7b" stroke="#ffffff" stroke-width="2.5"/>'
const toDataUri = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${body}</svg>`)}`
const plainIcon = toDataUri(baseIcon)
const alertIcon = toDataUri(baseIcon + alertDot)
const blinkIntervalMs = 800

export function useBlinkingFavicon(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.href = alertIcon
    document.head.appendChild(link)
    let showingAlert = true
    const timer = window.setInterval(() => {
      showingAlert = !showingAlert
      link.href = showingAlert ? alertIcon : plainIcon
    }, blinkIntervalMs)
    return () => {
      window.clearInterval(timer)
      link.remove()
    }
  }, [active])
}
