import { createContext, useContext } from 'react'
import type { EnrichedShot } from '@/lib/gspro/stats'

export type OpenReplay = (shots: EnrichedShot[], index: number) => void

export const ReplayContext = createContext<OpenReplay>(() => undefined)

export function useReplay() {
  return useContext(ReplayContext)
}

/** Removes deleted range shots from every list on the page. Course shots (sessions `gr_…`) are never passed here. */
export const ShotsRemovedContext = createContext<(ids: number[]) => void>(() => undefined)

export function useShotsRemoved() {
  return useContext(ShotsRemovedContext)
}
