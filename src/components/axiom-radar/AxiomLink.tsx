import type { KeyboardEvent, MouseEvent } from 'react'
import { axiomUrl } from './format'

const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation()

export function AxiomMark({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect width="24" height="24" rx="6" fill="currentColor" opacity="0.14"/>
    <path d="M12 4.5 19 19h-3.1l-1.3-2.9H9.4L8.1 19H5L12 4.5Zm0 6.1-1.6 3.6h3.2L12 10.6Z" fill="currentColor"/>
  </svg>
}

export function AxiomLink({ pairAddress, symbol, size = 14 }: { pairAddress: string | null | undefined; symbol: string; size?: number }) {
  if (!pairAddress) return null
  return <a className="radar-axiom-link" href={axiomUrl(pairAddress)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${symbol} on Axiom`} title={`Open ${symbol} on Axiom`} onClick={stop} onKeyDown={stop}>
    <AxiomMark size={size}/>
  </a>
}
