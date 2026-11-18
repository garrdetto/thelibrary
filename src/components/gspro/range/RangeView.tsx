import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TracePoint } from '@/lib/gspro/flight'
import { createRangeScene, type CameraMode, type RangeSceneApi } from './RangeScene'

export type RangeViewProps = {
  points: TracePoint[]
  landingIndex: number
  handed: 'RH' | 'LH'
  ballSpeed: number
  launch: number
  spin: number
  club: string
  clock: number
  mode: CameraMode
  fallback: ReactNode
}

function pointAt(points: TracePoint[], t: number) {
  for (let index = 1; index < points.length; index++) {
    if (points[index].t >= t) {
      const before = points[index - 1]
      const share = (t - before.t) / Math.max(1e-6, points[index].t - before.t)
      return { x: before.x + (points[index].x - before.x) * share, y: before.y + (points[index].y - before.y) * share, z: before.z + (points[index].z - before.z) * share }
    }
  }
  return points[points.length - 1]
}

export default function RangeView({ points, landingIndex, handed, ballSpeed, launch, spin, club, clock, mode, fallback }: RangeViewProps) {
  const box = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const api = useRef<RangeSceneApi | null>(null)
  const landingLabel = useRef<HTMLDivElement | null>(null)
  const restLabel = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(360)

  useEffect(() => {
    if (!canvas.current || !box.current) return
    let scene: RangeSceneApi
    try { scene = createRangeScene(canvas.current) } catch { setFailed(true); return }
    api.current = scene
    const node = box.current
    const update = () => {
      const width = Math.max(260, node.clientWidth)
      const next = Math.round(Math.min(520, Math.max(240, width * 0.52)))
      setHeight(next)
      scene.resize(width, next, window.devicePixelRatio || 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => { observer.disconnect(); scene.dispose(); api.current = null }
  }, [])

  useEffect(() => {
    api.current?.setShot({ points, landingIndex, handed, ballSpeed })
  }, [points, landingIndex, handed, ballSpeed])

  useEffect(() => {
    const scene = api.current
    if (!scene) return
    const info = scene.render(clock, mode)
    const place = (node: HTMLDivElement | null, spot: { x: number; y: number } | null) => {
      if (!node) return
      node.style.display = spot ? 'block' : 'none'
      if (spot) node.style.transform = `translate(${spot.x}px, ${spot.y}px)`
    }
    place(landingLabel.current, info.landing)
    place(restLabel.current, info.rest && info.landing && Math.hypot(info.rest.x - info.landing.x, info.rest.y - info.landing.y) > 4 ? info.rest : null)
  }, [clock, mode, points, landingIndex, height])

  if (failed) return <>{fallback}</>

  const t = Math.max(0, clock)
  const landing = points[landingIndex]
  const rest = points[points.length - 1]
  const current = pointAt(points, t)
  const landed = t >= landing.t
  const done = t >= rest.t
  const carry = landed ? landing.x : Math.max(0, current.x)
  const lateral = done ? rest.z : current.z

  return <div ref={box} className="gs-range" style={{ height }}>
    <canvas ref={canvas} className="gs-range-canvas" role="img" aria-label={`3D range replay: ${Math.round(landing.x)} yards carry, ${Math.round(rest.x)} yards total`}/>
    <div className="gs-range-hud" aria-hidden>
      <div className="gs-range-club">{club}</div>
      <div className="gs-range-numbers">
        <div><span>{landed ? 'Carry' : 'Distance'}</span><b>{Math.round(carry)}</b><small>yd</small></div>
        <div><span>{landed ? 'Total' : 'Height'}</span><b>{landed ? Math.round(done ? rest.x : current.x) : Math.round(Math.max(0, current.y))}</b><small>{landed ? 'yd' : 'ft'}</small></div>
        <div><span>{lateral >= 0 ? 'Right' : 'Left'}</span><b>{Math.round(Math.abs(lateral))}</b><small>yd</small></div>
      </div>
      <div className="gs-range-launch">{Math.round(ballSpeed)} mph · {launch.toFixed(1)}° · {Math.round(spin)} rpm</div>
    </div>
    <div ref={landingLabel} className="gs-range-tag"><span>{Math.round(landing.x)} yd carry</span></div>
    <div ref={restLabel} className="gs-range-tag rest"><span>{Math.round(rest.x)} yd total</span></div>
  </div>
}
