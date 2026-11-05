import { SPECIES, speciesIds, formatCaught, formatWeight, formatLength } from '../../modules-src/angler/shared/Species'
import type { SpeciesId } from '../../modules-src/angler/shared/Species'
import { LAKES, lakeIds } from '../../modules-src/angler/shared/Lakes'
import type { LakeId } from '../../modules-src/angler/shared/Lakes'

export { SPECIES, speciesIds, LAKES, lakeIds, formatCaught, formatWeight, formatLength }
export type { SpeciesId, LakeId }

export type AnglerPeriod = 'all' | 'month'

export type AnglerRecord = {
  id: string
  username: string
  weight: number
  length: number
  lake: LakeId
  spot: string
  tier: string
  rig: string
  date: string
}

export type AnglerBoard = {
  species: SpeciesId
  lake: LakeId | 'all'
  period: AnglerPeriod
  records: AnglerRecord[]
  personalBest: number | null
  signedIn: boolean
}

export type AnglerHallEntry = AnglerRecord & { species: SpeciesId }

export function isAnglerSpecies(value: unknown): value is SpeciesId {
  return typeof value === 'string' && (speciesIds as readonly string[]).includes(value)
}

export const ozToLb = (oz10: number) => oz10 / 160

export function formatCatchWeight(oz10: number) {
  return formatWeight(ozToLb(oz10))
}

export function formatCatchLength(quarters: number) {
  return formatLength(quarters / 4)
}

export async function fetchAnglerBoard(species: SpeciesId, lake: LakeId | 'all', period: AnglerPeriod): Promise<AnglerBoard> {
  const response = await fetch(`/api/angler?board=${encodeURIComponent(species)}&lake=${encodeURIComponent(lake)}&period=${period}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The record book is unavailable right now. Try again in a moment.')
  return await response.json() as AnglerBoard
}

export async function fetchAnglerHall(): Promise<AnglerHallEntry[]> {
  const response = await fetch('/api/angler?hall=1', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The Hall of Records is unavailable right now.')
  const result = await response.json() as { hall: AnglerHallEntry[] }
  return result.hall
}
