export type ClubInfo = { code: string; label: string; kind: 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter'; order: number; loft: number }

const table: ClubInfo[] = [
  { code: 'DR', label: 'Driver', kind: 'driver', order: 0, loft: 10.5 },
  { code: '2W', label: '2 wood', kind: 'wood', order: 1, loft: 13 },
  { code: '3W', label: '3 wood', kind: 'wood', order: 2, loft: 15 },
  { code: '4W', label: '4 wood', kind: 'wood', order: 3, loft: 17 },
  { code: '5W', label: '5 wood', kind: 'wood', order: 4, loft: 18 },
  { code: '7W', label: '7 wood', kind: 'wood', order: 5, loft: 21 },
  { code: '9W', label: '9 wood', kind: 'wood', order: 6, loft: 24 },
  { code: '2H', label: '2 hybrid', kind: 'hybrid', order: 7, loft: 17 },
  { code: '3H', label: '3 hybrid', kind: 'hybrid', order: 8, loft: 19 },
  { code: '4H', label: '4 hybrid', kind: 'hybrid', order: 9, loft: 22 },
  { code: '5H', label: '5 hybrid', kind: 'hybrid', order: 10, loft: 25 },
  { code: '6H', label: '6 hybrid', kind: 'hybrid', order: 11, loft: 28 },
  { code: '7H', label: '7 hybrid', kind: 'hybrid', order: 12, loft: 31 },
  { code: '1I', label: '1 iron', kind: 'iron', order: 13, loft: 16 },
  { code: '2I', label: '2 iron', kind: 'iron', order: 14, loft: 18 },
  { code: '3I', label: '3 iron', kind: 'iron', order: 15, loft: 20 },
  { code: '4I', label: '4 iron', kind: 'iron', order: 16, loft: 23 },
  { code: '5I', label: '5 iron', kind: 'iron', order: 17, loft: 26 },
  { code: '6I', label: '6 iron', kind: 'iron', order: 18, loft: 29 },
  { code: '7I', label: '7 iron', kind: 'iron', order: 19, loft: 33 },
  { code: '8I', label: '8 iron', kind: 'iron', order: 20, loft: 37 },
  { code: '9I', label: '9 iron', kind: 'iron', order: 21, loft: 41 },
  { code: 'PW', label: 'Pitching wedge', kind: 'wedge', order: 22, loft: 46 },
  { code: 'GW', label: 'Gap wedge', kind: 'wedge', order: 23, loft: 50 },
  { code: 'AW', label: 'Approach wedge', kind: 'wedge', order: 24, loft: 52 },
  { code: 'SW', label: '56° wedge', kind: 'wedge', order: 25, loft: 56 },
  { code: 'LW', label: '60° wedge', kind: 'wedge', order: 26, loft: 60 },
  { code: 'PT', label: 'Putter', kind: 'putter', order: 27, loft: 3 },
]

const byCode = new Map(table.map(club => [club.code, club]))

const aliases: Record<string, string> = {
  D: 'DR', DRIVER: 'DR', '1W': 'DR', W1: 'DR', DRV: 'DR',
  P: 'PW', PITCHINGWEDGE: 'PW', PITCHING: 'PW',
  G: 'GW', GAP: 'GW', GAPWEDGE: 'GW', UW: 'GW',
  A: 'AW', APPROACH: 'AW', APPROACHWEDGE: 'AW',
  S: 'SW', SAND: 'SW', SANDWEDGE: 'SW',
  L: 'LW', LOB: 'LW', LOBWEDGE: 'LW',
  PUTTER: 'PT', PUTT: 'PT',
}

export const allClubs: readonly ClubInfo[] = table

/** The clubs the analyzer records: driver, 3 and 5 wood, 3–9 iron, PW, AW, 56° and 60°. Shots tagged with any other club are dropped. */
export const recordedClubCodes = ['DR', '3W', '5W', '3I', '4I', '5I', '6I', '7I', '8I', '9I', 'PW', 'AW', 'SW', 'LW'] as const
const recordedSet = new Set<string>(recordedClubCodes)
export const recordedClubs: readonly ClubInfo[] = table.filter(club => recordedSet.has(club.code))

/** True for a club the analyzer keeps, and for an untagged shot (null), which the player can label afterwards. */
export function isRecordedClub(code: string | null) {
  return code === null || recordedSet.has(code)
}

/** Turns GSPro codes ("7I", "DR"), launch-monitor names ("7 Iron", "Driver", "56°") and similar into a GSPro club code. */
export function normalizeClub(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const compact = value.toUpperCase().replace(/[\s_.-]+/g, '')
  if (!compact) return null
  if (byCode.has(compact)) return compact
  if (aliases[compact]) return aliases[compact]
  const degrees = compact.match(/^(\d{2})(?:°|DEG|DEGREE)?$/)
  if (degrees) {
    const loft = Number(degrees[1])
    if (loft >= 44 && loft <= 64) return loft <= 47 ? 'PW' : loft <= 51 ? 'GW' : loft <= 53 ? 'AW' : loft <= 57 ? 'SW' : 'LW'
  }
  const named = compact.match(/^(\d)(IRON|I|WOOD|W|HYBRID|HY|H|RESCUE|R|UTILITY|U)$/) ?? compact.match(/^(IRON|I|WOOD|W|HYBRID|HY|H)(\d)$/)
  if (named) {
    const [number, kind] = /\d/.test(named[1]) ? [named[1], named[2]] : [named[2], named[1]]
    const letter = kind.startsWith('W') ? 'W' : kind.startsWith('I') || kind.startsWith('U') ? 'I' : 'H'
    const code = `${number}${letter}`
    if (byCode.has(code)) return code
  }
  return compact.length <= 12 ? compact : compact.slice(0, 12)
}

export function clubInfo(code: string | null): ClubInfo | null {
  return code ? byCode.get(code) ?? null : null
}

export function clubLabel(code: string | null) {
  if (!code) return 'Unknown club'
  return byCode.get(code)?.label ?? code
}

export function clubOrder(code: string | null) {
  return code ? byCode.get(code)?.order ?? 50 : 99
}

/** GSPro's club order as stored in its round file (`ClubIndex`); checked against ball speeds and putts in a saved round. */
const gsproIndexOrder = ['DR', '2W', '3W', '4W', '5W', '7W', '9W', '2H', '3H', '4H', '5H', '6H', '7H', '2I', '3I', '4I', '5I', '6I', '7I', '8I', '9I', 'PW', 'GW', 'AW', 'SW', 'LW', 'PT']

export function clubFromGsproIndex(index: number | null | undefined) {
  return typeof index === 'number' ? gsproIndexOrder[index] ?? null : null
}
