import type { Hardpoints } from '../sim/hardpoints'
import { APP_DEFAULTS, withDefaults } from '../sim/inputs'
import type { FrontAdj, RearAdj } from '../sim/inputs'
import { Lab } from '../sim/lab'
import type { Side, Snapshot } from '../sim/lab'

/** The original page's own state and functions, exposed by `site/bridge.js` (appended after the original's scripts). */
export type RailPage = {
  saved: Snapshot[]
  readonly adj: Record<Side, FrontAdj>
  readonly radj: RearAdj
  readonly HP: Hardpoints
  readonly HP0: Hardpoints
  readonly DEF: Record<string, string>
  readonly loaded: boolean
  setupEls(): HTMLInputElement[]
  snapshot(name: string): Snapshot
  fillLists(): void
  useHardpoints(j: unknown, name?: string): void
  replaceWriteSaved(f: () => void): () => void
  replaceUseHardpoints(f: (j: unknown, name?: string) => void): (j: unknown, name?: string) => void
}

/** Everything the page's numbers depend on (view controls aside): what the track test copies into a `Lab`. */
export type PageState = {
  hp: Hardpoints
  def: Record<string, string>
  inputs: Record<string, string>
  adj: Record<Side, FrontAdj>
  radj: RearAdj
  mrFixed: boolean
  view?: { heave: number; roll: number; steer: number; rack?: number }
}

export function railPage(): RailPage {
  const page = (window as unknown as { __rail?: RailPage }).__rail
  if (!page) throw new Error('Straight Rail Setup Lab page did not start')
  return page
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export function readPage(p: RailPage): PageState {
  const inputs: Record<string, string> = {}
  for (const e of p.setupEls()) inputs[e.id] = e.value
  return {
    hp: clone({ L: p.HP.L, R: p.HP.R, rear: p.HP.rear }),
    def: { ...p.DEF },
    inputs,
    adj: clone(p.adj),
    radj: { ...p.radj },
    mrFixed: (document.getElementById('mr-fixed') as HTMLInputElement | null)?.checked ?? false,
    view: { heave: viewValue('k-heave'), roll: viewValue('k-roll'), steer: viewValue('k-steer') },
  }
}

const viewValue = (id: string) => +((document.getElementById(id) as HTMLInputElement | null)?.value ?? 0) || 0

/**
 * A `Lab` (the renderer-free model the track test reads) holding exactly what the page holds: its hardpoints as they
 * stand (already seated, or a loaded file as given, as the original does), the fixed-MR switch, the page's own defaults
 * for empty boxes, the Heave, Roll and Steer view sliders (railVehicle zeroes them for the car on track), and either the
 * page's current setup or `snap`.
 */
export function labFromState(s: PageState, snap: Snapshot | null = null): Lab {
  const lab = new Lab()
  lab.useHardpoints(clone(s.hp), null, false)
  lab.mrFixedFlag = s.mrFixed
  lab.defaults = withDefaults(s.def, APP_DEFAULTS)
  lab.inputs = { ...lab.defaults }
  if (s.view) {
    lab.heave = s.view.heave
    lab.roll = s.view.roll
    lab.steerDeg = s.view.steer
  }
  lab.applySnapshot(snap ?? { name: '', inputs: s.inputs, adj: clone(s.adj), radj: { ...s.radj } })
  if (s.view?.rack !== undefined && s.view.rack !== lab.STEER) {
    lab.STEER = s.view.rack
    lab.calcGuess = { L: null, R: null }
    lab.update()
  }
  return lab
}

export const labFromPage = (p: RailPage, snap: Snapshot | null = null): Lab => labFromState(readPage(p), snap)
