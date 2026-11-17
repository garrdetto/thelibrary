import { z } from 'zod'
import { solanaAddressPattern } from './runtime.js'
import { trackerState } from './state.js'

/** Axiom lists besides Pulse that the bridge reads from the owner's open tabs: Discover's Trending and Surge. */
export const axiomListNames = ['trending', 'surge'] as const
export type AxiomList = (typeof axiomListNames)[number]
export const axiomListLabels: Record<AxiomList, string> = { trending: 'Trending', surge: 'Surge' }
/** A coin counts as on a list for this long after the bridge last saw it there, the same as a Pulse coin. */
export const axiomListWindowMs = 3 * 60_000

const listRowSchema = z.object({
  tokenAddress: z.string().regex(solanaAddressPattern),
  userCount: z.union([z.number(), z.string().max(40)]).nullable().optional(),
}).passthrough()

/** What the bridge sends for each list: its name and the coins on it. Rows are checked one at a time, so one odd row costs only itself. */
export const axiomListsSchema = z.array(z.object({ list: z.enum(axiomListNames), rows: z.array(z.unknown()).max(300) }).strict()).max(8)
export type AxiomListReport = z.infer<typeof axiomListsSchema>

const seenOn = new Map<string, Map<AxiomList, number>>()
export const axiomListSeen: Record<AxiomList, { at: number; count: number }> = { trending: { at: 0, count: 0 }, surge: { at: 0, count: 0 } }

/**
 * Takes the coins on the owner's open Discover lists into the tracker: each is remembered as on that list, so discovery
 * follows it the way it follows a Pulse coin, and a viewer count on the row is kept. Returns how many coins were read.
 */
export function applyAxiomLists(report: AxiomListReport, now: number) {
  let taken = 0
  for (const { list, rows } of report) {
    let count = 0
    for (const raw of rows) {
      const parsed = listRowSchema.safeParse(raw)
      if (!parsed.success) continue
      const mint = parsed.data.tokenAddress
      const lists = seenOn.get(mint) ?? new Map<AxiomList, number>()
      lists.set(list, now)
      seenOn.set(mint, lists)
      const viewers = typeof parsed.data.userCount === 'string' ? Number(parsed.data.userCount) : parsed.data.userCount
      if (typeof viewers === 'number' && Number.isFinite(viewers) && viewers >= 0) trackerState.viewers.set(mint, { count: Math.round(viewers), at: now, source: 'extension' })
      count += 1
    }
    axiomListSeen[list] = { at: now, count }
    taken += count
  }
  return taken
}

/** The lists a coin was seen on within the window, in a fixed order. */
export function axiomListsOf(mint: string, now: number): AxiomList[] {
  const lists = seenOn.get(mint)
  if (!lists) return []
  return axiomListNames.filter(list => now - (lists.get(list) ?? 0) <= axiomListWindowMs)
}

/** Every coin currently on a list; coins not seen within the window are forgotten. */
export function axiomListMints(now: number) {
  const mints: string[] = []
  for (const [mint, lists] of seenOn) {
    for (const [list, at] of lists) if (now - at > axiomListWindowMs) lists.delete(list)
    if (lists.size) mints.push(mint)
    else seenOn.delete(mint)
  }
  return mints
}

/** A short note for the intake's status line, or nothing when no list was read lately. */
export function axiomListNote(now: number) {
  const fresh = axiomListNames.filter(list => now - axiomListSeen[list].at < 15_000)
  return fresh.length ? `, ${fresh.map(list => `${axiomListSeen[list].count} on ${axiomListLabels[list]}`).join(', ')}` : ''
}

export function resetAxiomLists() {
  seenOn.clear()
  for (const list of axiomListNames) axiomListSeen[list] = { at: 0, count: 0 }
}
