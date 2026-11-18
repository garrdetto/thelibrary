import { createContext, useContext } from 'react'
import type { EnrichedShot } from '@/lib/gspro/stats'

export type OpenReplay = (shots: EnrichedShot[], index: number) => void

export const ReplayContext = createContext<OpenReplay>(() => undefined)

export function useReplay() {
  return useContext(ReplayContext)
}
