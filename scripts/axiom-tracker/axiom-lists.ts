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

/** What a Discover tab says about itself with every report: which list it is showing and how the bridge worked that out, the feeds it saw and the rows drawn. */
export const discoverProbeSchema = z.object({
  page: z.string().max(120),
  tab: z.enum(axiomListNames).nullable(),
  how: z.string().max(40),
  labels: z.string().max(200),
  sources: z.string().max(800),
  drawn: z.number().int().min(0).max(10_000),
}).strict()
export type DiscoverProbe = z.infer<typeof discoverProbeSchema>

const probes = new Map<string, { probe: DiscoverProbe; at: number }>()
const probeLoggedAt = new Map<string, number>()

/**
 * Remembers the latest report from each Discover tab (one per list it shows; tabs whose list is unknown are told apart by
 * the feeds they see). Returns true when what a tab says has changed and it has not been logged in the last minute.
 */
export function noteDiscoverProbe(probe: DiscoverProbe, now: number) {
  const key = probe.tab ?? `unknown ${probe.sources}`.slice(0, 200)
  const before = probes.get(key)?.probe
  probes.set(key, { probe, at: now })
  if (probes.size > 8) for (const [other, entry] of probes) if (now - entry.at > 60_000) { probes.delete(other); probeLoggedAt.delete(other) }
  const changed = !before || before.how !== probe.how || before.sources !== probe.sources || before.page !== probe.page
  if (!changed || now - (probeLoggedAt.get(key) ?? 0) < 60_000) return false
  probeLoggedAt.set(key, now)
  return true
}

/** One label in the row of Discover's sub-tabs and how it is drawn, as the bridge (1.12+) reports it. */
const discoverTabSchema = z.object({ text: z.string().max(24), top: z.number(), left: z.number(), height: z.number(), marked: z.boolean(), look: z.string().max(240), classes: z.string().max(200) }).strict()
/** What a Discover tab shows: its sub-tab labels and the coins drawn in its main list. */
export const discoverPageSchema = z.object({ tabs: z.array(discoverTabSchema).max(16), coins: z.array(z.unknown()).max(300) }).strict()
export type DiscoverTab = z.infer<typeof discoverTabSchema>
export type DiscoverPage = z.infer<typeof discoverPageSchema>

/** The list a sub-tab shows. Axiom's "Top" is its trending list; Callouts and Streamers are not coin lists the tracker follows. */
export function listOfTab(text: string): AxiomList | null {
  const label = text.trim()
  return /^(top|trending)$/i.test(label) ? 'trending' : /^surg(e|ing)$/i.test(label) ? 'surge' : null
}

function oddOneOut<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  const alone = [...groups.values()].filter(group => group.length === 1)
  return groups.size === 2 && alone.length === 1 && items.length >= 3 ? alone[0][0] : null
}

/** The names of Discover's sub-tabs. Anything else the bridge reports from around that row (filters, badges, labels inside the cards) is not a tab. */
const subTabNames = /^(top|trending|surge|callouts|streamers)$/i

/** The real sub-tabs among the labels the bridge reports: the named ones sitting in the same row as Top. */
export function discoverSubTabs(tabs: DiscoverTab[]) {
  const named = tabs.filter(tab => subTabNames.test(tab.text.trim()) && tab.height >= 14)
  const anchor = named.find(tab => /^(top|trending)$/i.test(tab.text.trim())) ?? named[0]
  return anchor ? named.filter(tab => Math.abs(tab.top - anchor.top) <= 14) : []
}

/**
 * Which sub-tab is selected. Axiom does not mark it; it draws the selected tab's text white and the others grey. So it
 * is the one tab drawn unlike the rest, which all look alike: by its text colour first, then its whole look, its class
 * names, and where it sits. When no tab stands out there is no answer.
 */
export function selectedDiscoverTab(reported: DiscoverTab[]): { tab: DiscoverTab; list: AxiomList | null; how: string } | null {
  const tabs = discoverSubTabs(reported)
  const pick = (tab: DiscoverTab, how: string) => ({ tab, list: listOfTab(tab.text), how })
  const marked = tabs.filter(tab => tab.marked)
  if (marked.length === 1) return pick(marked[0], 'marked selected')
  const ways: Array<[(tab: DiscoverTab) => string, string]> = [
    [tab => tab.look.split('|')[2] ?? '', 'its text is a different colour from the other tabs'],
    [tab => tab.look, 'drawn unlike the other tabs'],
    [tab => tab.classes, 'styled unlike the other tabs'],
    [tab => `${tab.top}|${tab.height}`, 'sits unlike the other tabs'],
  ]
  for (const [key, how] of ways) {
    const odd = oddOneOut(tabs, key)
    if (odd) return pick(odd, how)
  }
  return null
}

type DiscoverStatus = { at: number; text: string | null; list: AxiomList | null; how: string; coins: number; tabs: DiscoverTab[] }
const pages = new Map<string, DiscoverStatus>()

/**
 * Takes one Discover tab's report: works out which sub-tab is selected, and when it is a coin list (Top or Surge) takes
 * the coins drawn on the page, with the viewer counts on their cards, as members of that list. Returns what it decided
 * and whether that differs from the last report logged for this tab.
 */
export function applyDiscoverPage(page: DiscoverPage, cards: Array<{ mint: string | null; viewers: number }>, now: number) {
  const selected = selectedDiscoverTab(page.tabs)
  const rows = new Map<string, { tokenAddress: string; userCount?: number }>()
  for (const raw of page.coins) {
    const parsed = listRowSchema.safeParse(raw)
    if (!parsed.success) continue
    const viewers = typeof parsed.data.userCount === 'string' ? Number(parsed.data.userCount) : parsed.data.userCount
    rows.set(parsed.data.tokenAddress, { tokenAddress: parsed.data.tokenAddress, ...(typeof viewers === 'number' && Number.isFinite(viewers) ? { userCount: viewers } : {}) })
  }
  for (const card of cards) if (card.mint) rows.set(card.mint, { tokenAddress: card.mint, userCount: card.viewers })
  const list = selected?.list ?? null
  const key = selected ? `tab ${selected.tab.text}` : 'unknown'
  const before = pages.get(key)
  const status: DiscoverStatus = { at: now, text: selected?.tab.text ?? null, list, how: selected?.how ?? 'no tab stands out', coins: rows.size, tabs: discoverSubTabs(page.tabs) }
  pages.set(key, status)
  if (pages.size > 8) for (const [other, entry] of pages) if (now - entry.at > 60_000) pages.delete(other)
  if (list && rows.size >= 3) applyAxiomLists([{ list, rows: [...rows.values()] }], now)
  const changed = (!before || before.how !== status.how || before.list !== status.list || now - before.at > 60_000) && now - (probeLoggedAt.get(key) ?? 0) >= 60_000
  if (changed) probeLoggedAt.set(key, now)
  return { status, changed }
}

/** The status line for the Discover tabs: what each open one is showing and where its coins come from, or what is missing. */
export function discoverNote(now: number) {
  const seen = [...pages.values()].filter(status => now - status.at < 30_000)
  if (seen.length) {
    return seen.map(status => {
      if (status.list) return `${axiomListLabels[status.list]} (Axiom's ${status.text} tab is selected: ${status.how}): ${status.coins} coins read`
      if (status.text) return `A Discover tab is on ${status.text}, which is not a coin list the tracker follows`
      return `A Discover tab is open but no sub-tab stands out as selected${status.tabs.length ? `: ${status.tabs.map(tab => `${tab.text} [${tab.look}] {${tab.classes.slice(0, 50)}} @${tab.top}/${tab.height}`).join('; ')}` : ' (its tab row has not been read yet)'}`
    }).join(' | ').slice(0, 900)
  }
  const fresh = [...probes.entries()].filter(([, entry]) => now - entry.at < 30_000)
  if (!fresh.length) return null
  return fresh.map(([key, { probe }]) => {
    if (probe.tab === null) return `A Discover tab is open but the bridge cannot tell which list it shows (${probe.how}; ${probe.labels}); ${probe.drawn} coins drawn${probe.sources ? `; feeds ${probe.sources}` : ''}`
    const list = key as AxiomList
    const named = probe.sources.split('; ').filter(source => (list === 'surge' ? /surg/i : /trend/i).test(source))
    return `${axiomListLabels[list]} tab (${probe.how}): ${axiomListSeen[list].count} coins from ${named.length ? named.join(', ') : `the ${probe.drawn} rows drawn`}${probe.sources && !named.length ? `; other feeds ${probe.sources}` : ''}`
  }).join(' | ').slice(0, 900)
}

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
  probes.clear()
  probeLoggedAt.clear()
  pages.clear()
  for (const list of axiomListNames) axiomListSeen[list] = { at: 0, count: 0 }
}
