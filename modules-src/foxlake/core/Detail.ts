/**
 * Life Sim's two detail levels. Everyone starts on Standard, a lighter picture that runs smoother on most computers;
 * High is the full picture. The Esc menu switches between them at once, and the choice is kept on this device.
 *
 * Standard draws at up to 1080 lines instead of 1440, turns town cells and woods off sooner (700 m, still inside the
 * day fog), draws grass out to 70 % as far, swaps trees to their low models sooner, leaves bloom off and paints other
 * people's clothes at half size. The player's own character is drawn the same at both levels.
 */

export type DetailLevel = 'standard' | 'high'

export interface DetailSettings {
  /** Most lines the frame is rendered at. */
  lines: number
  /** Where town cells and wood stands are switched off, metres. */
  cullReach: number
  /** Share of the grass's usual reach. */
  grass: number
  /** Trees swap to their low model and then out at these distances, metres. */
  treeLow: number
  treeOut: number
  bloom: boolean
  /** Texture size other people's tailored clothes are painted at. */
  crowdCloth: number
}

export const DETAIL: Record<DetailLevel, DetailSettings> = {
  standard: { lines: 1080, cullReach: 700, grass: 0.7, treeLow: 80, treeOut: 520, bloom: false, crowdCloth: 512 },
  high: { lines: 1440, cullReach: 860, grass: 1, treeLow: 115, treeOut: 640, bloom: true, crowdCloth: 1024 },
}

export const DEFAULT_DETAIL: DetailLevel = 'standard'
const KEY = 'tl-lifesim-detail'

/** The device's saved level; `?detail=high` or `?detail=standard` overrides it for one visit. */
export function loadDetail(search = typeof location === 'undefined' ? '' : location.search): DetailLevel {
  const asked = new URLSearchParams(search).get('detail')
  if (asked === 'high' || asked === 'standard') return asked
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'high' ? 'high' : DEFAULT_DETAIL
  } catch {
    return DEFAULT_DETAIL
  }
}

export function saveDetail(level: DetailLevel): void {
  try {
    localStorage.setItem(KEY, level)
  } catch {
    return
  }
}
