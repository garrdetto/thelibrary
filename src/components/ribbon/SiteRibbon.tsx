import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { MusicPlayer } from '@/components/music/MusicPlayer'

export const RIBBON_START = 'site-ribbon-start'
export const RIBBON_END = 'site-ribbon-end'

export function SiteRibbon() {
  return <footer className="site-ribbon" aria-label="Site bar">
    <div id={RIBBON_START} className="site-ribbon-start"/>
    <MusicPlayer/>
    <div className="site-ribbon-spacer"/>
    <div id={RIBBON_END} className="site-ribbon-end"/>
  </footer>
}

export function RibbonSlot({ slot, children }: { slot: typeof RIBBON_START | typeof RIBBON_END; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => { setTarget(document.getElementById(slot)) }, [slot])
  return target ? createPortal(children, target) : null
}
