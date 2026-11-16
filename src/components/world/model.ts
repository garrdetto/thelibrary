import type { MapDoc, MapGrids } from '../../../modules-src/tello/data/MapData'
import { markStreetsFixed } from '../../../modules-src/tello/data/Streets'
import { TelloLand } from '../../../modules-src/tello/region'
import { EditSession, type EditReport } from '../../../modules-src/tello/edits/Apply'
import { unionBox, type Box } from '../../../modules-src/tello/edits/Geom'
import { emptyEdits, mapStamp, type EditOp, type WorldEdits } from '../../../modules-src/tello/edits/WorldEdits'
import { MONTELLO_AT } from '../../../modules-src/foxlake/region'
import { LAKE_LEVEL } from '../../../modules-src/foxlake/lake/Rebase'
import { isBlocked } from '../../../modules-src/tello/world/Clearance'
import { loadMontelloFiles } from './loadMap'
import { DEFAULT_SETTINGS, type ToolId, type ToolSettings } from './settings'

/** Heights the administrator reads and types are relative to Lake Montello's surface; the map's own are above its base. */
export const toLake = (mapHeight: number) => mapHeight - LAKE_LEVEL
export const fromLake = (lakeHeight: number) => lakeHeight + LAKE_LEVEL

export type Selection =
  | { kind: 'road'; id: string }
  | { kind: 'building'; id: string }
  | { kind: 'lot'; id: string }
  | { kind: 'op'; id: string }
  | null

interface Pristine {
  doc: MapDoc
  ground: Uint16Array
  water: Uint16Array
  cover: Uint8Array
  canopy: Uint8Array
  clear: Int8Array
}

const UNDO_LIMIT = 200
const STRUCTURAL = new Set<EditOp['type']>(['road', 'roadRemove', 'roadSet', 'building', 'buildingRemove', 'buildingSet'])

/**
 * The World Editor's state: the map as baked and fixed (kept untouched), the working copy with the edits replayed on
 * it, the edit list with undo and redo, the selection and the tool settings. New edits are applied on top of the
 * working copy; anything that changes an earlier edit replays the whole list on a fresh copy.
 */
export class EditorModel {
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  progress = { share: 0, text: '' }
  error = ''
  land: TelloLand | null = null
  ops: EditOp[] = []
  report: EditReport = { applied: 0, skipped: [] }
  base = ''
  selection: Selection = null
  tool: ToolId = 'select'
  settings: ToolSettings = structuredClone(DEFAULT_SETTINGS)
  /** Bumped whenever the land changes. */
  version = 0
  busy = false
  private pristine: Pristine | null = null
  private session: EditSession | null = null
  private dirtyBox: Box | null = null
  private dirtyAll = true
  private undoStack: EditOp[][] = []
  private redoStack: EditOp[][] = []
  private listeners = new Set<() => void>()
  private tick = 0

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot = (): number => this.tick

  emit(): void {
    this.tick++
    for (const fn of this.listeners) fn()
  }

  async load(): Promise<void> {
    if (this.status === 'loading' || this.status === 'ready') return
    this.status = 'loading'
    this.emit()
    try {
      const { doc, grids } = await loadMontelloFiles((share, text) => {
        this.progress = { share, text }
        this.emit()
      })
      this.progress = { share: 0.75, text: 'Applying Tello’s street fixes…' }
      this.emit()
      await nextFrame()
      const land = new TelloLand(doc, grids, MONTELLO_AT)
      this.pristine = {
        doc: structuredClone(land.doc),
        ground: grids.ground.slice(),
        water: grids.water.slice(),
        cover: grids.cover.slice(),
        canopy: grids.canopy.slice(),
        clear: grids.clear.slice(),
      }
      this.base = mapStamp(land.doc)
      this.land = land
      this.trees = { treeX: grids.treeX, treeZ: grids.treeZ, treeS: grids.treeS, treeH: grids.treeH }
      this.session = new EditSession(land.doc, land.grids)
      this.session.finish()
      this.progress = { share: 1, text: 'Ready' }
      this.status = 'ready'
      this.dirtyAll = true
      this.version++
      this.scheduleBlocked()
    } catch (error) {
      this.status = 'error'
      this.error = error instanceof Error ? error.message : 'The map could not be loaded.'
    }
    this.emit()
  }

  /** Puts a saved edit list in place (on load or after restoring a revision); clears undo. */
  setDocument(edits: WorldEdits | null): void {
    this.ops = edits?.ops ? [...edits.ops] : []
    this.undoStack = []
    this.redoStack = []
    this.selection = null
    this.replay()
  }

  document(): WorldEdits {
    return { ...emptyEdits(this.base), ops: this.ops }
  }

  // ------------------------------------------------------------ editing

  add(op: EditOp | EditOp[]): void {
    const list = Array.isArray(op) ? op : [op]
    if (!list.length || !this.session || !this.land) return
    this.pushUndo()
    this.session.dirty = null
    const before = this.session.report.skipped.length
    for (const o of list) {
      this.ops.push(o)
      this.session.apply(o)
    }
    this.session.finish()
    this.land.refreshDecks()
    this.report = { applied: this.session.report.applied, skipped: [...this.session.report.skipped] }
    this.dirtyBox = unionBox(this.dirtyBox, this.session.dirty)
    this.version++
    if (list.some((o) => STRUCTURAL.has(o.type))) this.scheduleBlocked()
    if (this.session.report.skipped.length > before) this.lastProblem = this.session.report.skipped[this.session.report.skipped.length - 1].why
    else this.lastProblem = ''
    this.emit()
  }

  /** The reason the last edit could not be applied, if it could not. */
  lastProblem = ''

  remove(id: string): void {
    if (!this.ops.some((o) => o.id === id)) return
    this.pushUndo()
    this.ops = this.ops.filter((o) => o.id !== id)
    if (this.selection?.kind === 'op' && this.selection.id === id) this.selection = null
    this.replay()
  }

  update(id: string, patch: Partial<EditOp>): void {
    const i = this.ops.findIndex((o) => o.id === id)
    if (i < 0) return
    this.pushUndo()
    this.ops = this.ops.map((o) => (o.id === id ? ({ ...o, ...patch } as EditOp) : o))
    this.replay()
  }

  toggle(id: string): void {
    const op = this.ops.find((o) => o.id === id)
    if (op) this.update(id, { on: op.on === false ? undefined : false })
  }

  move(id: string, to: number): void {
    const i = this.ops.findIndex((o) => o.id === id)
    if (i < 0 || to < 0 || to >= this.ops.length || to === i) return
    this.pushUndo()
    const next = [...this.ops]
    const [op] = next.splice(i, 1)
    next.splice(to, 0, op)
    this.ops = next
    this.replay()
  }

  clearAll(): void {
    if (!this.ops.length) return
    this.pushUndo()
    this.ops = []
    this.selection = null
    this.replay()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(this.ops)
    this.ops = prev
    this.replay()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.ops)
    this.ops = next
    this.replay()
  }

  private pushUndo(): void {
    this.undoStack.push(this.ops.slice())
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
  }

  /** Replays every edit on a fresh copy of the fixed map. */
  replay(): void {
    const p = this.pristine
    const old = this.land
    if (!p || !old) return
    this.busy = true
    const doc = structuredClone(p.doc)
    markStreetsFixed(doc)
    const g = old.grids
    const grids: MapGrids = {
      side: g.side,
      fineSide: g.fineSide,
      ground: p.ground.slice(),
      water: p.water.slice(),
      cover: p.cover.slice(),
      tone: g.tone,
      canopy: p.canopy.slice(),
      clear: p.clear.slice(),
      treeX: this.trees!.treeX,
      treeZ: this.trees!.treeZ,
      treeS: this.trees!.treeS,
      treeH: this.trees!.treeH,
      play: g.play,
    }
    const land = new TelloLand(doc, grids, MONTELLO_AT)
    const session = new EditSession(doc, grids)
    for (const op of this.ops) session.apply(op)
    session.finish()
    land.refreshDecks()
    this.land = land
    this.session = session
    this.report = { applied: session.report.applied, skipped: [...session.report.skipped] }
    this.lastProblem = ''
    this.dirtyAll = true
    this.version++
    this.busy = false
    this.scheduleBlocked()
    this.emit()
  }

  private trees: { treeX: Uint16Array; treeZ: Uint16Array; treeS: Uint8Array; treeH: Uint8Array } | null = null

  /** What changed on the land since the view last asked: 'all', a box, or nothing. */
  takeDirty(): Box | 'all' | null {
    if (this.dirtyAll) {
      this.dirtyAll = false
      this.dirtyBox = null
      return 'all'
    }
    const box = this.dirtyBox
    this.dirtyBox = null
    return box
  }

  /** Buildings a road runs through (Life Sim leaves them out), worked out a moment after roads or buildings change. */
  blockedIds: Set<string> = new Set()
  private blockedTimer: ReturnType<typeof setTimeout> | null = null

  private scheduleBlocked(): void {
    if (this.blockedTimer) clearTimeout(this.blockedTimer)
    this.blockedTimer = setTimeout(() => {
      this.blockedTimer = null
      const land = this.land
      if (!land) return
      const view = Object.create(land) as TelloLand
      Object.defineProperty(view, 'doc', { value: { ...land.doc } })
      const set = new Set<string>()
      for (const b of land.doc.buildings) if (b.id && !b.x && isBlocked(view, b)) set.add(b.id)
      this.blockedIds = set
      this.dirtyAll = true
      this.emit()
    }, 500)
  }

  select(sel: Selection): void {
    this.selection = sel
    this.emit()
  }

  setTool(tool: ToolId): void {
    this.tool = tool
    this.emit()
  }

  patchSettings(patch: Partial<ToolSettings>): void {
    this.settings = { ...this.settings, ...patch }
    this.emit()
  }

  patchGroup<K extends 'river' | 'road' | 'building' | 'lot' | 'trees' | 'rail' | 'light' | 'wall'>(key: K, patch: Partial<ToolSettings[K]>): void {
    this.settings = { ...this.settings, [key]: { ...this.settings[key], ...patch } }
    this.emit()
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}
