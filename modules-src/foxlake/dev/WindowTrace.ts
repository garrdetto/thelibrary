/**
 * Trace windows (developer panel): the administrator fixes where a scanned
 * vehicle's glass is. The camera turns around the vehicle (right-drag, arrow
 * keys, wheel); a loop drawn with the left mouse button over a window turns
 * the body triangles inside it that face the camera into glass (Add) or back
 * into body (Remove). Every edit is shown at once on every copy of that
 * vehicle on this page (ScanGlass.reglaze) with the glass highlighted; Save
 * stores the list on the vehicle's record (PATCH /api/maplestreet-vehicles
 * `{id, glass}`, administrators only), so every player sees it from their
 * next load. Cancel puts back what was drawn before.
 *
 * Triangles are numbered as in the model file (VehicleGlass.ts), which is what
 * the saved list refers to. The lasso and the runs encoding are shared,
 * renderer-free code; this file only projects triangles and draws.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { GameHost } from '../../rackreel/game/Game'
import type { GlassBody, VehicleView } from '../fp/physics/VehicleModels'
import { bodyPositions, currentGlass, detectedGlass, pristineIndices, reglaze } from '../fp/physics/ScanGlass'
import { customVehicleRecord, setCustomVehicleGlass } from '../../maplestreet/shared/CustomVehicles'
import { encodeGlassRuns, lassoTriangles, type ScreenPoint, type VehicleGlass } from '../../maplestreet/shared/VehicleGlass'
import { tidyWindows } from '../../maplestreet/shared/WindowDetect'

interface Part {
  mesh: Mesh
  /** The mesh's place among the model's meshes (what the saved list keys on). */
  index: number
  pristine: Uint32Array
  flags: Uint8Array
  /** What was drawn when the tool opened, for Cancel. */
  before: { flags: Uint8Array; traced: boolean }
  overlay: Mesh | null
}

const UNDO_LIMIT = 40
const PITCH = { min: -0.15, max: 1.35 }
const MIN_LOOP_POINTS = 3

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(text: string, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'rr-btn primary' : 'rr-btn', text)
  b.type = 'button'
  return b
}

export class WindowTrace {
  private readonly root = el('div', 'fl-trace')
  private readonly sketch = el('canvas', 'fl-trace-sketch')
  private readonly bar = el('aside', 'fl-trace-bar')
  private readonly title = el('h2')
  private readonly status = el('p', 'fl-trace-status')
  private readonly addMode = el('input')
  private readonly removeMode = el('input')
  private readonly highlight = el('input')
  private readonly bothSides = el('input')
  private readonly undoButton = button('Undo')
  private readonly forgetButton = button('Remove saved tracing')
  private readonly saveButton = button('Save for everyone', true)
  private view: VehicleView | null = null
  private body: GlassBody | null = null
  private parts: Part[] = []
  private undo: Uint8Array[][] = []
  private material: StandardMaterial | null = null
  private loop: ScreenPoint[] = []
  private drawing = false
  private orbiting: { x: number; y: number } | null = null
  private yaw = 0
  private pitch = 0.35
  private dist = 7
  private centre = Vector3.Zero()
  private saving = false
  private edited = false

  constructor(private readonly host: GameHost, private readonly onClose: (text: string) => void) {
    const root = this.root
    root.hidden = true
    root.dataset.hostModal = ''
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Trace windows')
    this.sketch.setAttribute('aria-hidden', 'true')
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    root.append(this.sketch, this.buildBar())
    document.body.append(root)

    this.sketch.addEventListener('contextmenu', (e) => e.preventDefault())
    this.sketch.addEventListener('pointerdown', (e) => this.pointerDown(e))
    this.sketch.addEventListener('pointermove', (e) => this.pointerMove(e))
    this.sketch.addEventListener('pointerup', (e) => this.pointerUp(e))
    this.sketch.addEventListener('pointercancel', () => { this.drawing = false; this.orbiting = null; this.loop = []; this.paint() })
    this.sketch.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12) }, { passive: false })
    addEventListener('keydown', (e) => this.key(e), true)
    addEventListener('resize', () => this.fit())
  }

  get active(): boolean {
    return !this.root.hidden
  }

  /** Opens the tool on a vehicle; returns why it can't, or null when it opened. */
  start(view: VehicleView): string | null {
    if (this.active) return 'Trace windows is already open.'
    const body = view.glassBody()
    if (!body) return 'That vehicle has a modelled body whose windows are real glass already, so there is nothing to trace. Pick a scanned (published or bundled) vehicle.'
    const parts: Part[] = []
    for (const mesh of body.scanned) {
      const now = currentGlass(mesh), pristine = pristineIndices(mesh)
      if (!now || !pristine || mesh.isDisposed()) continue
      parts.push({ mesh, index: body.meshes.indexOf(mesh), pristine, flags: Uint8Array.from(now.flags), before: now, overlay: null })
    }
    if (!parts.length || parts.some((p) => p.index < 0)) return 'The windows of that vehicle are still loading. Try again in a moment.'
    this.view = view
    this.body = body
    this.parts = parts
    this.undo = []
    this.edited = false
    this.title.textContent = `Trace windows: ${body.name}`
    this.forgetButton.hidden = !customVehicleRecord(`custom:${body.recordId}`)?.glass
    this.frameCamera()
    this.root.hidden = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.fit()
    this.refresh()
    this.say(parts.some((p) => p.before.traced) ? 'Showing the saved tracing.' : 'Showing the automatic windows. Draw a loop over a window to fix it.')
    this.saveButton.focus()
    return null
  }

  /** Each frame: holds the camera on the vehicle; closes when the vehicle goes away. */
  update(): void {
    if (!this.active) return
    const view = this.view
    if (!view || !view.glassBody() || this.parts.some((p) => p.mesh.isDisposed())) {
      this.finish('The vehicle went away, so the tracing was closed without saving.')
      return
    }
    const target = Vector3.TransformCoordinates(this.centre, view.root.getWorldMatrix())
    const cp = Math.cos(this.pitch)
    const eye = target.add(new Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).scaleInPlace(this.dist))
    this.host.setCameraShot({ eye, target })
  }

  // ------------------------------------------------------------ layout

  private buildBar(): HTMLElement {
    const bar = this.bar
    const head = el('header', 'fl-trace-head')
    head.append(this.title)
    const help = el('p', '', 'Drag with the left mouse button to draw a loop over a window. Right-drag or the arrow keys turn around the vehicle; the wheel or + and − zoom. Only faces turned toward you are picked.')
    const modes = el('fieldset', 'fl-trace-modes')
    const legend = el('legend', '', 'A loop')
    modes.append(legend)
    for (const [input, text, value] of [[this.addMode, 'Adds glass (A)', 'add'], [this.removeMode, 'Removes glass (R)', 'remove']] as const) {
      input.type = 'radio'
      input.name = 'fl-trace-mode'
      input.value = value
      const label = el('label')
      label.append(input, el('span', '', text))
      modes.append(label)
    }
    this.addMode.checked = true
    modes.addEventListener('change', () => this.paint())
    const options = el('div', 'fl-trace-options')
    for (const [input, text, on] of [[this.highlight, 'Highlight glass', true], [this.bothSides, 'Also pick faces turned away', false]] as const) {
      input.type = 'checkbox'
      input.checked = on
      const label = el('label')
      label.append(input, el('span', '', text))
      options.append(label)
    }
    this.highlight.addEventListener('change', () => this.refresh())
    const edits = el('div', 'fl-trace-grid')
    const tidy = button('Tidy up')
    tidy.title = 'Drops specks of glass and fills small holes in a pane'
    tidy.addEventListener('click', () => this.tidy())
    const clear = button('Clear all glass')
    clear.addEventListener('click', () => this.edit((p) => p.flags.fill(0), 'All glass cleared.'))
    const auto = button('Start from automatic')
    auto.title = 'Puts back the windows the game finds by itself'
    auto.addEventListener('click', () => this.edit((p) => { const d = detectedGlass(p.mesh); if (d) p.flags.set(d) }, 'Back to the automatic windows.'))
    this.undoButton.addEventListener('click', () => this.stepBack())
    edits.append(this.undoButton, tidy, clear, auto)
    const finish = el('div', 'fl-trace-grid')
    const cancel = button('Cancel')
    cancel.addEventListener('click', () => this.cancel())
    this.saveButton.addEventListener('click', () => void this.save(false))
    this.forgetButton.title = 'Deletes the saved tracing so the vehicle goes back to the automatic windows'
    this.forgetButton.addEventListener('click', () => void this.save(true))
    finish.append(this.saveButton, cancel, this.forgetButton)
    bar.append(head, help, modes, options, edits, this.status, finish)
    return bar
  }

  private fit(): void {
    const ratio = Math.min(2, devicePixelRatio || 1)
    this.sketch.width = Math.round(innerWidth * ratio)
    this.sketch.height = Math.round(innerHeight * ratio)
    this.paint()
  }

  private say(text: string, warn = false): void {
    const stats = this.counts()
    this.status.textContent = `${text}${text ? ' ' : ''}${stats.toLocaleString()} glass triangles.`
    this.status.classList.toggle('warn', warn)
    this.undoButton.disabled = !this.undo.length
  }

  private counts(): number {
    let n = 0
    for (const p of this.parts) for (let t = 0; t < p.flags.length; t++) n += p.flags[t]
    return n
  }

  // ------------------------------------------------------------ camera

  /** Frames the vehicle's body from where the camera is now. */
  private frameCamera(): void {
    const view = this.view!
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const p of this.parts) {
      p.mesh.computeWorldMatrix(true)
      const box = p.mesh.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, box.minimumWorld)
      max = Vector3.Maximize(max, box.maximumWorld)
    }
    const centre = min.add(max).scaleInPlace(0.5)
    const radius = Math.max(1, max.subtract(min).length() / 2)
    const inv = view.root.computeWorldMatrix(true).clone().invert()
    this.centre = Vector3.TransformCoordinates(centre, inv)
    const cam = this.host.ctx.camera.position
    this.yaw = Math.atan2(cam.x - centre.x, cam.z - centre.z)
    this.pitch = 0.35
    this.dist = radius * 2.3
  }

  private turn(dx: number, dy: number): void {
    this.yaw += dx
    this.pitch = Math.min(PITCH.max, Math.max(PITCH.min, this.pitch + dy))
  }

  private zoom(k: number): void {
    this.dist = Math.min(30, Math.max(1.5, this.dist * k))
  }

  // ------------------------------------------------------------ input

  private point(e: PointerEvent): ScreenPoint {
    const r = this.sketch.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private pointerDown(e: PointerEvent): void {
    if (this.saving) return
    this.sketch.setPointerCapture(e.pointerId)
    if (e.button === 2 || e.button === 1) {
      this.orbiting = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button !== 0) return
    this.drawing = true
    this.loop = [this.point(e)]
    this.paint()
  }

  private pointerMove(e: PointerEvent): void {
    if (this.orbiting) {
      this.turn((e.clientX - this.orbiting.x) * 0.008, (e.clientY - this.orbiting.y) * 0.006)
      this.orbiting = { x: e.clientX, y: e.clientY }
      return
    }
    if (!this.drawing) return
    const p = this.point(e), last = this.loop[this.loop.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return
    this.loop.push(p)
    this.paint()
  }

  private pointerUp(e: PointerEvent): void {
    if (this.sketch.hasPointerCapture(e.pointerId)) this.sketch.releasePointerCapture(e.pointerId)
    if (this.orbiting) { this.orbiting = null; return }
    if (!this.drawing) return
    this.drawing = false
    const loop = this.loop
    this.loop = []
    this.paint()
    if (loop.length < MIN_LOOP_POINTS) return
    this.lasso(loop, this.removeMode.checked ? 'remove' : 'add')
  }

  private key(e: KeyboardEvent): void {
    if (!this.active) return
    const typing = e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number')
    if (e.code === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.cancel()
      return
    }
    if (typing || e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space') return
    const step = 0.08
    let used = true
    if (e.code === 'ArrowLeft') this.turn(-step, 0)
    else if (e.code === 'ArrowRight') this.turn(step, 0)
    else if (e.code === 'ArrowUp') this.turn(0, step)
    else if (e.code === 'ArrowDown') this.turn(0, -step)
    else if (e.key === '+' || e.key === '=') this.zoom(1 / 1.12)
    else if (e.key === '-' || e.key === '_') this.zoom(1.12)
    else if (e.code === 'KeyA') this.addMode.checked = true
    else if (e.code === 'KeyR') this.removeMode.checked = true
    else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.stepBack()
    else used = false
    if (used) { e.preventDefault(); e.stopImmediatePropagation() }
  }

  /** The loop being drawn, on the 2D sketch layer over the scene. */
  private paint(): void {
    const ctx = this.sketch.getContext('2d')
    if (!ctx) return
    const k = this.sketch.width / Math.max(1, innerWidth)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    if (this.loop.length < 2) return
    const remove = this.removeMode.checked
    ctx.beginPath()
    ctx.moveTo(this.loop[0].x, this.loop[0].y)
    for (const p of this.loop) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fillStyle = remove ? 'rgba(255,120,90,.18)' : 'rgba(53,208,255,.18)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.setLineDash([7, 5])
    ctx.strokeStyle = remove ? '#ff8a6a' : '#35d0ff'
    ctx.stroke()
  }

  // ------------------------------------------------------------ edits

  private snapshot(): void {
    this.undo.push(this.parts.map((p) => Uint8Array.from(p.flags)))
    if (this.undo.length > UNDO_LIMIT) this.undo.shift()
  }

  private stepBack(): void {
    const step = this.undo.pop()
    if (!step) return this.say('Nothing to undo.')
    this.parts.forEach((p, i) => p.flags.set(step[i]))
    this.edited = true
    this.refresh()
    this.say('Undone.')
  }

  /** Runs one change on every part, keeps an undo step when anything changed, and redraws. */
  private edit(change: (p: Part) => void, text: string): void {
    const before = this.parts.map((p) => Uint8Array.from(p.flags))
    for (const p of this.parts) change(p)
    const changed = this.parts.some((p, i) => p.flags.some((f, t) => f !== before[i][t]))
    if (!changed) return this.say(`${text.replace(/\.$/, '')}: nothing changed.`)
    this.undo.push(before)
    if (this.undo.length > UNDO_LIMIT) this.undo.shift()
    this.edited = true
    this.refresh()
    this.say(text)
  }

  private tidy(): void {
    this.edit((p) => {
      const positions = bodyPositions(p.mesh)
      if (positions) tidyWindows({ positions, indices: p.pristine }, p.flags)
    }, 'Specks dropped and small holes filled.')
  }

  /** Projects every triangle of the body and applies the loop. */
  private lasso(loop: ScreenPoint[], mode: 'add' | 'remove'): void {
    const scene = this.host.ctx.scene
    const camera = scene.activeCamera
    if (!camera) return
    const vp = scene.getTransformMatrix().m
    const eye = camera.globalPosition
    const rect = this.sketch.getBoundingClientRect()
    const both = this.bothSides.checked
    const flips: Uint8Array[] = []
    let total = 0
    for (const p of this.parts) {
      const pos = p.mesh.getVerticesData(VertexBuffer.PositionKind)
      if (!pos) { flips.push(p.flags); continue }
      const world = p.mesh.computeWorldMatrix(true)
      const mirror = world.determinant() < 0 ? -1 : 1
      const w = new Float32Array(pos.length)
      const v = new Vector3()
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], world, v)
        w[i] = v.x; w[i + 1] = v.y; w[i + 2] = v.z
      }
      const tris = p.pristine.length / 3
      const screen = new Float32Array(tris * 2)
      const facing = new Uint8Array(tris)
      for (let t = 0; t < tris; t++) {
        const a = p.pristine[t * 3] * 3, b = p.pristine[t * 3 + 1] * 3, c = p.pristine[t * 3 + 2] * 3
        const cx = (w[a] + w[b] + w[c]) / 3, cy = (w[a + 1] + w[b + 1] + w[c + 1]) / 3, cz = (w[a + 2] + w[b + 2] + w[c + 2]) / 3
        const clipW = cx * vp[3] + cy * vp[7] + cz * vp[11] + vp[15]
        if (clipW <= 1e-4) { screen[t * 2] = NaN; screen[t * 2 + 1] = NaN; continue }
        const nx = (cx * vp[0] + cy * vp[4] + cz * vp[8] + vp[12]) / clipW
        const ny = (cx * vp[1] + cy * vp[5] + cz * vp[9] + vp[13]) / clipW
        screen[t * 2] = ((nx + 1) / 2) * rect.width
        screen[t * 2 + 1] = ((1 - ny) / 2) * rect.height
        if (both) { facing[t] = 1; continue }
        const ux = w[b] - w[a], uy = w[b + 1] - w[a + 1], uz = w[b + 2] - w[a + 2]
        const qx = w[c] - w[a], qy = w[c + 1] - w[a + 1], qz = w[c + 2] - w[a + 2]
        const fx = uy * qz - uz * qy, fy = uz * qx - ux * qz, fz = ux * qy - uy * qx
        facing[t] = mirror * (fx * (eye.x - cx) + fy * (eye.y - cy) + fz * (eye.z - cz)) > 0 ? 1 : 0
      }
      const next = Uint8Array.from(p.flags)
      total += lassoTriangles(screen, facing, loop, next, mode)
      flips.push(next)
    }
    if (!total) return this.say(mode === 'add' ? 'No body faces inside that loop face you. Turn toward the window, or tick “Also pick faces turned away”.' : 'No glass inside that loop.', true)
    this.snapshot()
    this.parts.forEach((p, i) => p.flags.set(flips[i]))
    this.edited = true
    this.refresh()
    this.say(`${mode === 'add' ? 'Added' : 'Removed'} ${total.toLocaleString()} triangles.`)
  }

  /** Shows the flags on the vehicle (and every copy of it here) and redraws the highlight. */
  private refresh(): void {
    for (const p of this.parts) {
      reglaze(p.mesh, p.flags)
      this.drawOverlay(p)
    }
  }

  private overlayMaterial(): StandardMaterial {
    if (this.material) return this.material
    const m = new StandardMaterial('trace-glass', this.host.ctx.scene)
    m.disableLighting = true
    m.emissiveColor = new Color3(0.2, 0.82, 1)
    m.diffuseColor = Color3.Black()
    m.specularColor = Color3.Black()
    m.alpha = 0.42
    m.backFaceCulling = false
    m.zOffset = -4
    m.disableDepthWrite = true
    this.material = m
    return m
  }

  private drawOverlay(p: Part): void {
    p.overlay?.dispose()
    p.overlay = null
    if (!this.highlight.checked || !this.active) return
    const picked: number[] = []
    for (let t = 0; t < p.flags.length; t++) if (p.flags[t]) picked.push(p.pristine[t * 3], p.pristine[t * 3 + 1], p.pristine[t * 3 + 2])
    const pos = p.mesh.getVerticesData(VertexBuffer.PositionKind)
    if (!picked.length || !pos) return
    const overlay = new Mesh('trace-glass', this.host.ctx.scene)
    const data = new VertexData()
    data.positions = pos
    data.indices = picked
    data.applyToMesh(overlay)
    overlay.parent = p.mesh
    overlay.isPickable = false
    overlay.material = this.overlayMaterial()
    p.overlay = overlay
  }

  // ------------------------------------------------------------ save and close

  private glass(): VehicleGlass {
    return { v: 1, parts: this.parts.map((p) => ({ mesh: p.index, tris: p.flags.length, verts: p.mesh.getTotalVertices(), runs: encodeGlassRuns(p.flags) })) }
  }

  private async save(forget: boolean): Promise<void> {
    const body = this.body
    if (!body || this.saving) return
    if (forget && !confirm('Delete the saved tracing? The vehicle goes back to the windows the game finds by itself, for everyone.')) return
    const glass = forget ? null : this.glass()
    this.saving = true
    this.saveButton.disabled = true
    this.forgetButton.disabled = true
    this.say('Saving…')
    try {
      const res = await fetch('/api/maplestreet-vehicles', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: body.recordId, glass }),
      })
      const answer = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        const text = typeof answer.error === 'string' ? answer.error : res.status === 401 || res.status === 403 ? 'Only the administrator can save traced windows. Sign in as the administrator.' : 'The windows could not be saved. Try again.'
        this.say(text, true)
        return
      }
      setCustomVehicleGlass(`custom:${body.recordId}`, glass)
      if (forget) for (const p of this.parts) p.before = { flags: detectedGlass(p.mesh) ?? p.flags, traced: false }
      else for (const p of this.parts) p.before = { flags: Uint8Array.from(p.flags), traced: true }
      this.finish(forget ? `${body.name}: saved tracing removed; automatic windows are back for everyone.` : `${body.name}: windows saved. Everyone sees them the next time the vehicle loads.`)
    } catch {
      this.say('The windows could not be saved: no connection. Try again.', true)
    } finally {
      this.saving = false
      this.saveButton.disabled = false
      this.forgetButton.disabled = false
    }
  }

  private cancel(): void {
    if (this.saving || (this.edited && !confirm('Close without saving? Your changes to the windows are dropped.'))) return
    this.finish('Tracing cancelled; nothing was saved.')
  }

  /** Closes the tool and draws the vehicle as `before` says (what was saved, or what showed when the tool opened). */
  private finish(text: string): void {
    if (!this.active) return
    for (const p of this.parts) {
      if (!p.mesh.isDisposed()) reglaze(p.mesh, p.before.traced ? p.before.flags : null)
      p.overlay?.dispose()
      p.overlay = null
    }
    this.parts = []
    this.undo = []
    this.view = null
    this.body = null
    this.loop = []
    this.drawing = false
    this.orbiting = null
    this.root.hidden = true
    this.host.setCameraShot(null)
    this.onClose(text)
  }
}
