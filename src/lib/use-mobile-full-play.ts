import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Modules whose play frame fills the whole screen on phones and tablets. */
export const MOBILE_FULL_MODULES: ReadonlySet<string> = new Set(['shorttrack', 'darts'])
/** Phones in either orientation and touch tablets up to 1024 px wide. */
export const MOBILE_FULL_QUERY = '(max-width: 650px), (pointer: coarse) and (max-width: 1024px), (pointer: coarse) and (max-height: 600px)'

/**
 * Mobile full screen for the play frame. The frame covers the screen while `full` is on; the module
 * (modules-src/_shared/embed-full.js) says hello on load, gets {type:'tl-full', on}, acknowledges it and shows its own
 * "Exit full screen" buttons, which post 'tl-exit-full'. Until the module acknowledges, the site shows a fallback close
 * button so a page that fails to load never traps the player.
 */
export function useMobileFullPlay(moduleId: string | undefined, frame: RefObject<HTMLIFrameElement | null>) {
  const supported = !!moduleId && MOBILE_FULL_MODULES.has(moduleId)
  const [mobile, setMobile] = useState(false)
  const [wanted, setWanted] = useState(true)
  const [ack, setAck] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(MOBILE_FULL_QUERY)
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => { setWanted(true); setAck(false) }, [moduleId])

  const available = supported && mobile
  const full = available && wanted

  useEffect(() => {
    if (!supported) return
    const send = () => frame.current?.contentWindow?.postMessage({ type: 'tl-full', on: full }, window.location.origin)
    send()
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !frame.current || event.source !== frame.current.contentWindow) return
      const type = event.data?.type
      if (type === 'tl-full-hello') send()
      else if (type === 'tl-full-ack') setAck(true)
      else if (type === 'tl-exit-full') setWanted(false)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [supported, full, frame])

  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    root.classList.add('play-full-lock')
    return () => root.classList.remove('play-full-lock')
  }, [full])

  return { available, full, ack, enter: () => setWanted(true), exit: () => setWanted(false) }
}
