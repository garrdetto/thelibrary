import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Grid3x3, LoaderCircle, X } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { TelloLand } from '../../../modules-src/tello/region'
import { buildPreviewScene } from './preview3d/build'
import type { PreviewScene, PreviewStats } from './preview3d/build'
import { Draft3D } from './preview3d/draft'
import type { EditorModel } from './model'
import { toLake } from './model'
import type { Pointer, ScreenSpace, ToolRunner } from './tools'

export interface WorldPreview3DProps {
  /** The World Editor's edited copy of Montello. */
  land: TelloLand
  /** Middle of the area shown, map metres (x east, z north). */
  center: { x: number; z: number }
  /** Side of the area in metres; the toolbar can change it afterwards. */
  size: number
  /** Bumped by the editor whenever `land` changes; the view rebuilds. */
  version: number
  /** With a model and a tool runner the view is an editor: every tool works on the 3D ground. */
  model?: EditorModel
  runner?: ToolRunner | null
  /** Called when the view moves on to a new area as the camera travels (map metres). */
  onCentre?: (x: number, z: number) => void
  onClose?: () => void
}

const AREA_SIZES = [300, 600, 1000, 1500]
const SKY = 0xbcd6ec
const ELEVATION = (35 * Math.PI) / 180
const FOLLOW = 0.3

interface Viewer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  fog: THREE.Fog
  content: PreviewScene | null
  draft: Draft3D
  render: () => void
}

interface Readout { x: number; z: number; ground: number; water: number | null }

function sizeLabel(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${metres} m`
}

function applyWireframe(group: THREE.Object3D, on: boolean): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of list) if ('wireframe' in material) (material as THREE.MeshLambertMaterial).wireframe = on
  })
}

function frameView(viewer: Viewer, land: TelloLand, x: number, z: number, size: number): void {
  const ground = land.inside(x, z) ? land.heightAt(x, z) : 0
  const target = new THREE.Vector3(x, ground, -z)
  const distance = size * 0.6
  const flat = (Math.cos(ELEVATION) * distance) / Math.SQRT2
  const { camera, controls } = viewer
  camera.position.set(target.x + flat, target.y + Math.sin(ELEVATION) * distance, target.z + flat)
  camera.near = 0.5
  camera.far = Math.max(4000, size * 6)
  camera.updateProjectionMatrix()
  controls.target.copy(target)
  controls.minDistance = 4
  controls.maxDistance = size * 2.5
  controls.update()
}

/** Where a ray from the camera first meets the ground (or a bridge deck), by marching along it over the height grid. */
function groundHit(land: TelloLand, origin: THREE.Vector3, dir: THREE.Vector3, far: number): { x: number; z: number } | null {
  const h = (x: number, z: number) => (land.inside(x, z) ? land.heightAt(x, z) : -1e6)
  let prev = 0
  let t = 0.5
  while (t < far) {
    const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = -(origin.z + dir.z * t)
    if (y <= h(x, z)) {
      let lo = prev, hi = t
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2
        const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = -(origin.z + dir.z * mid)
        if (my <= h(mx, mz)) hi = mid
        else lo = mid
      }
      return { x: origin.x + dir.x * hi, z: -(origin.z + dir.z * hi) }
    }
    prev = t
    t += Math.min(12, Math.max(0.4, t * 0.012))
  }
  return null
}

export default function WorldPreview3D({ land, center, size, version, model, runner, onCentre, onClose }: WorldPreview3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [area, setArea] = useState(size)
  const [shownSize, setShownSize] = useState(size)
  const [wireframe, setWireframe] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(true)
  const [glError, setGlError] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [stats, setStats] = useState<PreviewStats | null>(null)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [focus, setFocus] = useState({ x: center.x, z: center.z })
  const [shownCentre, setShownCentre] = useState(center)
  const wireRef = useRef(false)
  const framedRef = useRef('')
  const props = useRef({ land, model, runner, onCentre, onClose, area, focus })
  props.current = { land, model, runner, onCentre, onClose, area, focus }
  const editable = !!(model && runner)

  if (size !== shownSize) {
    setShownSize(size)
    setArea(size)
  }
  if (center.x !== shownCentre.x || center.z !== shownCentre.z) {
    setShownCentre(center)
    setFocus({ x: center.x, z: center.z })
  }

  const refreshDraft = useCallback(() => {
    const viewer = viewerRef.current
    const { runner: r, model: m, land: l } = props.current
    if (!viewer || !r || !m) return
    const dist = viewer.camera.position.distanceTo(viewer.controls.target)
    const px = (dist * 2 * Math.tan((viewer.camera.fov * Math.PI) / 360)) / Math.max(1, viewer.renderer.domElement.clientHeight)
    viewer.draft.update(r, m, l, px)
    viewer.render()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      setGlError('The 3D view needs WebGL, and this browser could not start it.')
      setBusy(false)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(SKY)
    const canvas = renderer.domElement
    canvas.className = 'we3d-canvas'
    host.appendChild(canvas)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(SKY)
    const fog = new THREE.Fog(SKY, 1200, 4500)
    scene.fog = fog
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x6b5f4a, 1.3))
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3)
    sun.position.set(-0.45, 0.8, 0.4)
    scene.add(sun)
    const draft = new Draft3D()
    scene.add(draft.group)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.screenSpacePanning = false
    controls.maxPolarAngle = Math.PI * 0.495
    controls.listenToKeyEvents(host)
    const editing = () => !!(props.current.model && props.current.runner)
    const buttons = (space: boolean) => {
      controls.mouseButtons = editing()
        ? { LEFT: space ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
        : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    }
    buttons(false)

    let frame = 0
    let dragging = false
    const tick = () => {
      const moved = controls.update()
      renderer.render(scene, camera)
      frame = moved || dragging ? requestAnimationFrame(tick) : 0
      if (!frame) follow()
    }
    const render = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const follow = () => {
      const { focus: f, area: a } = props.current
      const tx = controls.target.x, tz = -controls.target.z
      if (Math.hypot(tx - f.x, tz - f.z) > a * FOLLOW) {
        setFocus({ x: Math.round(tx), z: Math.round(tz) })
        props.current.onCentre?.(tx, tz)
      }
    }
    const onStart = () => { dragging = true; render() }
    const onEnd = () => { dragging = false; render() }
    controls.addEventListener('change', render)
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const onLost = (event: Event) => {
      event.preventDefault()
      setGlError('The 3D view lost its graphics context. Switch views and come back.')
    }
    canvas.addEventListener('webglcontextlost', onLost)

    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const rayFrom = (e: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return { px: e.clientX - r.left, py: e.clientY - r.top }
    }
    const space: ScreenSpace = {
      project(x, z) {
        const l = props.current.land
        const v = new THREE.Vector3(x, l.inside(x, z) ? l.heightAt(x, z) : 0, -z).project(camera)
        if (v.z > 1) return null
        return [((v.x + 1) / 2) * canvas.clientWidth, ((1 - v.y) / 2) * canvas.clientHeight]
      },
      mPerPx(x, z) {
        const l = props.current.land
        const d = camera.position.distanceTo(new THREE.Vector3(x, l.inside(x, z) ? l.heightAt(x, z) : 0, -z))
        return (d * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight)
      },
    }
    const pointerAt = (e: PointerEvent | MouseEvent, solids: boolean): Pointer | null => {
      const { px, py } = rayFrom(e)
      const l = props.current.land
      let hit: { x: number; z: number } | null = null
      if (solids) {
        const mesh = viewerRef.current?.content?.group.getObjectByName('solids')
        const found = mesh ? ray.intersectObject(mesh, false)[0] : undefined
        if (found) {
          const p = found.point.clone().addScaledVector(ray.ray.direction, 0.3)
          hit = { x: p.x, z: -p.z }
        }
      }
      hit = hit ?? groundHit(l, ray.ray.origin, ray.ray.direction, camera.far)
      if (!hit) return null
      return { x: hit.x, z: hit.z, px, py, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
    }
    let toolDrag = false
    let spaceDown = false
    const onDown = (e: PointerEvent) => {
      const { runner: r, model: m } = props.current
      host.focus({ preventScroll: true })
      if (!r || !m || e.button !== 0 || spaceDown) return
      const p = pointerAt(e, m.tool === 'select' || m.tool === 'buildingRemove')
      if (!p) return
      r.space = space
      if (r.pointerDown(p)) {
        toolDrag = true
        canvas.setPointerCapture(e.pointerId)
      }
      refreshDraft()
    }
    let moveQueued: PointerEvent | null = null
    const onMove = (e: PointerEvent) => {
      moveQueued = e
      requestAnimationFrame(() => {
        const ev = moveQueued
        moveQueued = null
        if (!ev) return
        const { runner: r, land: l } = props.current
        const p = pointerAt(ev, false)
        if (!p) { setReadout(null); return }
        const w = l.waterAt(p.x, p.z)
        setReadout({ x: p.x, z: p.z, ground: toLake(l.groundAt(p.x, p.z)), water: w === null ? null : toLake(w) })
        if (!r || dragging) return
        r.space = space
        r.pointerMove(p)
        refreshDraft()
      })
    }
    const onUp = (e: PointerEvent) => {
      const { runner: r } = props.current
      if (!toolDrag || !r) return
      toolDrag = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      const p = pointerAt(e, false)
      r.space = space
      r.pointerUp(p ?? { x: r.hover?.x ?? 0, z: r.hover?.z ?? 0, px: 0, py: 0, button: 0, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
      refreshDraft()
    }
    const onDouble = () => props.current.runner?.doubleClick()
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      spaceDown = e.type === 'keydown'
      buttons(spaceDown)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('dblclick', onDouble)
    canvas.addEventListener('pointerleave', () => setReadout(null))
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    viewerRef.current = { renderer, scene, camera, controls, fog, content: null, draft, render }
    setReady(true)

    return () => {
      setReady(false)
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('dblclick', onDouble)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      controls.removeEventListener('change', render)
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
      controls.stopListenToKeyEvents()
      controls.dispose()
      viewerRef.current?.content?.dispose()
      draft.dispose()
      viewerRef.current = null
      framedRef.current = ''
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [refreshDraft])

  useEffect(() => {
    if (!runner || !model) return
    runner.watchers.add(refreshDraft)
    const off = model.subscribe(refreshDraft)
    return () => {
      runner.watchers.delete(refreshDraft)
      off()
    }
  }, [runner, model, refreshDraft])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!ready || !viewer) return
    let cancelled = false
    setBusy(true)
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const half = area / 2
      let next: PreviewScene
      try {
        next = buildPreviewScene(land, { x0: focus.x - half, z0: focus.z - half, x1: focus.x + half, z1: focus.z + half })
      } catch {
        setBuildError('The 3D view could not be built for this area.')
        setBusy(false)
        return
      }
      if (cancelled || viewerRef.current !== viewer) {
        next.dispose()
        return
      }
      viewer.content?.dispose()
      viewer.content = next
      viewer.scene.add(next.group)
      applyWireframe(next.group, wireRef.current)
      viewer.fog.near = area * 1.2
      viewer.fog.far = area * 4.5
      const key = `${shownCentre.x}|${shownCentre.z}|${area}`
      if (framedRef.current !== key) {
        framedRef.current = key
        frameView(viewer, land, focus.x, focus.z, area)
      }
      setStats(next.stats)
      setBuildError(null)
      setBusy(false)
      refreshDraft()
      viewer.render()
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ready, land, version, focus.x, focus.z, area, shownCentre.x, shownCentre.z, refreshDraft])

  useEffect(() => {
    wireRef.current = wireframe
    const viewer = viewerRef.current
    if (!viewer?.content) return
    applyWireframe(viewer.content.group, wireframe)
    viewer.render()
  }, [wireframe])

  useEffect(() => {
    if (editable) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      props.current.onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable])

  const recenter = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const { land: l, focus: f, area: a } = props.current
    frameView(viewer, l, f.x, f.z, a)
    viewer.render()
  }, [])

  const options = AREA_SIZES.includes(area) ? AREA_SIZES : [...AREA_SIZES, area].sort((a, b) => a - b)
  const failure = glError ?? buildError

  return (
    <section className={`we3d${editable ? ' is-editing' : ''}`} aria-label="3D view">
      <div className="we3d-bar" role="toolbar" aria-label="3D view controls">
        <span className="we3d-title">{editable ? '3D world' : '3D preview'}</span>
        <label className="we3d-field">
          <span>Area</span>
          <select value={area} onChange={(event) => setArea(Number(event.target.value))} disabled={!!glError}>
            {options.map((metres) => (
              <option key={metres} value={metres}>
                {sizeLabel(metres)} square
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="we3d-btn" aria-pressed={wireframe} onClick={() => setWireframe((on) => !on)} disabled={!!glError}>
          <Grid3x3 size={15} aria-hidden="true" />
          <span>Wireframe</span>
        </button>
        <button type="button" className="we3d-btn" onClick={recenter} disabled={!ready} aria-label="Put the camera back over the area">
          <Crosshair size={15} aria-hidden="true" />
          <span>Recenter</span>
        </button>
        {onClose && (
          <button type="button" className="we3d-btn we3d-close" onClick={onClose} aria-label="Close the 3D view" title={editable ? 'Back to the map' : 'Close (Esc)'}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="we3d-view">
        <div
          ref={hostRef}
          className="we3d-host"
          tabIndex={glError ? -1 : 0}
          role="application"
          aria-roledescription="3D view"
          aria-label={editable ? '3D view of the edited map. The picked tool works on the ground. Right-drag to orbit, middle-drag or Shift and right-drag to pan, scroll to zoom.' : '3D view of the edited map. Drag to orbit, right-drag or arrow keys to pan, scroll to zoom.'}
        />
        {busy && !failure && (
          <div className="we3d-busy" role="status">
            <LoaderCircle size={16} aria-hidden="true" />
            <span>Building…</span>
          </div>
        )}
        {failure && (
          <div className="we3d-error" role="alert">
            {failure}
          </div>
        )}
        {stats && !glError && !readout && (
          <p className="we3d-stats">
            {stats.triangles.toLocaleString()} triangles · {stats.buildings.toLocaleString()} buildings · {stats.trees.toLocaleString()} trees
          </p>
        )}
        {readout && (
          <p className="we3d-stats">
            x {readout.x.toFixed(1)} · z {readout.z.toFixed(1)} · ground {readout.ground >= 0 ? '+' : '−'}{Math.abs(readout.ground).toFixed(2)} m
            {readout.water !== null && ` · water ${(readout.water - readout.ground).toFixed(2)} m deep`}
          </p>
        )}
        {!glError && (
          <p className="we3d-hint" aria-hidden="true">
            {editable ? 'Right-drag orbits · Shift+right-drag pans · scroll zooms' : 'Drag to orbit · right-drag to pan · scroll to zoom'}
          </p>
        )}
      </div>
    </section>
  )
}
