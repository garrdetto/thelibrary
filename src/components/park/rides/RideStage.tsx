import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Plane, Vector3 } from 'three'
import type { Group } from 'three'
import type { CustomRideMotion, CustomRidePlatform } from '../../../../server/park/index.mjs'
import type { RideMesh } from '@/lib/park/rideMesh'
import { PLATFORM_PART, partMatrices } from '@/lib/park/ridePlatform'
import { TILE_METRES } from './bake'

export type StageClock = { phase: 'loading' | 'running'; timer: number; speed: number }

type Props = {
  mesh: RideMesh | null
  motion: CustomRideMotion
  platform?: CustomRidePlatform
  size: [number, number]
  rideTime: number
  loadTime: number
  paused: boolean
  rate: number
  restart: number
  step: number
  guides: boolean
  focus: number | null
  onCanvas?: (canvas: HTMLCanvasElement | null) => void
  onClock?: (clock: StageClock) => void
  onPivot?: (pivot: [number, number, number]) => void
  onSplit?: (split: number) => void
}

const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
const STEP_SECONDS = 1 / 30

function partGeometries(mesh: RideMesh) {
  const counts = new Map<number, number>()
  for (let t = 0; t < mesh.triangles; t++) counts.set(mesh.parts[t * 3], (counts.get(mesh.parts[t * 3]) ?? 0) + 1)
  const out: { part: number; geometry: BufferGeometry }[] = []
  for (const [part, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    const pos = new Float32Array(count * 9), nor = new Float32Array(count * 9), col = new Float32Array(count * 9)
    let o = 0
    for (let t = 0; t < mesh.triangles; t++) {
      if (mesh.parts[t * 3] !== part) continue
      pos.set(mesh.positions.subarray(t * 9, t * 9 + 9), o)
      nor.set(mesh.normals.subarray(t * 9, t * 9 + 9), o)
      for (let j = 0; j < 9; j++) col[o + j] = toLinear(mesh.colors[t * 9 + j])
      o += 9
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(pos, 3))
    geometry.setAttribute('normal', new BufferAttribute(nor, 3))
    geometry.setAttribute('color', new BufferAttribute(col, 3))
    geometry.computeBoundingSphere()
    out.push({ part, geometry })
  }
  return out
}

function Footprint({ size }: { size: [number, number] }) {
  const geometry = useMemo(() => {
    const [w, h] = size, hw = w * TILE_METRES / 2, hh = h * TILE_METRES / 2, points: number[] = []
    for (let i = 0; i <= w; i++) { const x = -hw + i * TILE_METRES; points.push(x, -hh, 0.02, x, hh, 0.02) }
    for (let j = 0; j <= h; j++) { const y = -hh + j * TILE_METRES; points.push(-hw, y, 0.02, hw, y, 0.02) }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3)); return g
  }, [size])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group>
    <mesh position={[0, 0, 0.01]} receiveShadow><planeGeometry args={[size[0] * TILE_METRES, size[1] * TILE_METRES]}/><meshStandardMaterial color="#8f8b80" roughness={0.95}/></mesh>
    <lineSegments geometry={geometry}><lineBasicMaterial color="#f2b544"/></lineSegments>
  </group>
}

function Ride({ mesh, motion, platform, rideTime, loadTime, paused, rate, restart, step, guides, focus, size, onClock, onPivot, onSplit }: Omit<Props, 'onCanvas'>) {
  const geometries = useMemo(() => mesh ? partGeometries(mesh) : [], [mesh])
  useEffect(() => () => geometries.forEach(g => g.geometry.dispose()), [geometries])
  const groups = useRef(new Map<number, Group>())
  const clock = useRef({ phase: 'loading' as StageClock['phase'], timer: 0, spin: 0, speed: 0 })
  const pendingSteps = useRef(0)
  const reported = useRef(0)
  const matrix = useMemo(() => new Matrix4(), [])

  useEffect(() => { clock.current = { phase: 'loading', timer: 0, spin: 0, speed: 0 } }, [restart])
  useEffect(() => { if (step) pendingSteps.current += 1 }, [step])

  useFrame((_, delta) => {
    const c = clock.current
    let dt = paused ? 0 : Math.min(0.1, delta) * rate
    if (paused && pendingSteps.current > 0) { pendingSteps.current -= 1; dt = STEP_SECONDS }
    if (dt > 0) {
      c.timer += dt
      if (c.phase === 'loading' && c.timer > loadTime) { c.phase = 'running'; c.timer = 0 }
      else if (c.phase === 'running' && c.timer > rideTime) { c.phase = 'loading'; c.timer = 0 }
      const running = c.phase === 'running'
      if (running) { c.spin += dt * Math.min(1, c.speed); c.speed = Math.min(1, c.speed + dt * 0.25) }
      else { c.speed = Math.max(0, c.speed - dt * 0.6); c.spin += dt * c.speed }
    }
    if (mesh) {
      const all = partMatrices(motion, platform, mesh.instances, { spin: c.spin, timer: c.timer, running: c.phase === 'running', speed: c.speed }, rideTime, mesh.height)
      for (const [part, group] of groups.current) {
        const m = all[part]
        if (!m) continue
        matrix.fromArray(m)
        group.matrix.copy(matrix)
        group.matrixWorldNeedsUpdate = true
      }
    }
    reported.current += Math.min(0.1, delta)
    if (onClock && reported.current > 0.2) { reported.current = 0; onClock({ phase: c.phase, timer: c.timer, speed: c.speed }) }
  })

  const span = Math.max(size[0], size[1]) * TILE_METRES
  const pivotSize = Math.max(0.18, span * 0.008)
  return <group>
    {geometries.map(({ part, geometry }) => {
      const instance = part > 1 && part < PLATFORM_PART ? mesh?.instances[part - 2] : undefined
      const lit = instance !== undefined && focus === instance.group
      return <group key={`${part}-${geometry.uuid}`} matrixAutoUpdate={false} ref={node => { if (node) groups.current.set(part, node); else groups.current.delete(part) }}>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={part ? 0.68 : 0.72} metalness={part ? 0.08 : 0.05} side={DoubleSide} emissive={lit ? '#ff7a2f' : '#000000'} emissiveIntensity={lit ? 0.7 : 0}/>
        </mesh>
        {guides && instance && <mesh position={instance.pivot}><sphereGeometry args={[pivotSize, 12, 8]}/><meshBasicMaterial color={lit ? '#ffd166' : '#7cf29a'} depthTest={false} transparent opacity={0.9}/></mesh>}
      </group>
    })}
    {guides && motion.type !== 'none' && <>
      <mesh position={[0, 0, motion.split]}><planeGeometry args={[span, span]}/><meshBasicMaterial color="#4cc3ff" transparent opacity={0.14} depthWrite={false} side={DoubleSide}/></mesh>
      {motion.type !== 'drop' && motion.type !== 'bob' && <PivotHandle pivot={motion.pivot} radius={Math.max(0.3, span * 0.016)} half={span / 2} onPivot={onPivot}/>}
      <SplitHandle split={motion.split} at={span / 2 + Math.max(0.4, span * 0.04)} top={Math.max(1, (mesh?.height ?? 6))} radius={Math.max(0.3, span * 0.018)} onSplit={onSplit}/>
    </>}
    {guides && focus !== null && motion.pieces[focus] && <PieceBand piece={motion.pieces[focus]} centre={motion.pivot} span={span}/>}
  </group>
}

type Drag = { active: boolean }

/** Ride space is Z up inside a group turned -90° about X, so world (x, y, z) is ride (x, -z, y). */
function useDrag(onMove: (world: Vector3, event: ThreeEvent<PointerEvent>) => void, plane: (event: ThreeEvent<PointerEvent>) => Plane) {
  const controls = useThree(state => state.controls) as { enabled: boolean } | null
  const drag = useRef<Drag>({ active: false })
  const current = useRef<Plane | null>(null)
  const hit = useMemo(() => new Vector3(), [])
  return {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      drag.current.active = true
      current.current = plane(event)
      ;(event.target as Element).setPointerCapture?.(event.pointerId)
      if (controls) controls.enabled = false
      document.body.style.cursor = 'grabbing'
    },
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      if (!drag.current.active || !current.current) return
      event.stopPropagation()
      if (event.ray.intersectPlane(current.current, hit)) onMove(hit, event)
    },
    onPointerUp: (event: ThreeEvent<PointerEvent>) => {
      if (!drag.current.active) return
      drag.current.active = false
      ;(event.target as Element).releasePointerCapture?.(event.pointerId)
      if (controls) controls.enabled = true
      document.body.style.cursor = ''
    },
    onPointerOver: () => { if (!drag.current.active) document.body.style.cursor = 'grab' },
    onPointerOut: () => { if (!drag.current.active) document.body.style.cursor = '' },
  }
}

const snap = (v: number) => Math.round(v * 20) / 20

function PivotHandle({ pivot, radius, half, onPivot }: { pivot: [number, number, number]; radius: number; half: number; onPivot?: (pivot: [number, number, number]) => void }) {
  const handlers = useDrag(world => {
    const x = Math.max(-half, Math.min(half, snap(world.x))), y = Math.max(-half, Math.min(half, snap(-world.z)))
    if (x !== pivot[0] || y !== pivot[1]) onPivot?.([x, y, pivot[2]])
  }, () => new Plane(new Vector3(0, 1, 0), -pivot[2]))
  return <mesh position={pivot} {...(onPivot ? handlers : {})}><sphereGeometry args={[radius, 18, 12]}/><meshBasicMaterial color="#ff5c8a" depthTest={false} transparent opacity={0.95}/></mesh>
}

function SplitHandle({ split, at, top, radius, onSplit }: { split: number; at: number; top: number; radius: number; onSplit?: (split: number) => void }) {
  const camera = useThree(state => state.camera)
  const handlers = useDrag(world => {
    const z = Math.max(0, Math.min(top, snap(world.y)))
    if (z !== split) onSplit?.(z)
  }, () => {
    const facing = new Vector3(); camera.getWorldDirection(facing); facing.y = 0
    if (facing.lengthSq() < 1e-6) facing.set(0, 0, 1)
    facing.normalize()
    return new Plane().setFromNormalAndCoplanarPoint(facing, new Vector3(at, split, 0))
  })
  if (!onSplit) return null
  return <group position={[at, 0, split]} {...handlers}>
    <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[radius, radius, radius * 0.7, 20]}/><meshBasicMaterial color="#4cc3ff" depthTest={false} transparent opacity={0.95}/></mesh>
    <mesh position={[0, 0, radius * 1.1]} rotation-x={Math.PI / 2}><coneGeometry args={[radius * 0.6, radius * 0.9, 16]}/><meshBasicMaterial color="#4cc3ff" depthTest={false} transparent opacity={0.95}/></mesh>
    <mesh position={[0, 0, -radius * 1.1]} rotation-x={-Math.PI / 2}><coneGeometry args={[radius * 0.6, radius * 0.9, 16]}/><meshBasicMaterial color="#4cc3ff" depthTest={false} transparent opacity={0.95}/></mesh>
  </group>
}

function PieceBand({ piece, centre, span }: { piece: CustomRideMotion['pieces'][number]; centre: [number, number, number]; span: number }) {
  const outer = Math.min(piece.outer, span * 0.75), inner = Math.min(piece.inner, outer)
  const tall = Math.max(0.02, piece.to - piece.from)
  return <group position={[centre[0], centre[1], piece.from + tall / 2]} rotation-x={Math.PI / 2}>
    <mesh><cylinderGeometry args={[outer, outer, tall, 48, 1, true]}/><meshBasicMaterial color="#ffb84c" transparent opacity={0.1} depthWrite={false} side={DoubleSide}/></mesh>
    {inner > 0.05 && <mesh><cylinderGeometry args={[inner, inner, tall, 32, 1, true]}/><meshBasicMaterial color="#ffb84c" transparent opacity={0.08} depthWrite={false} side={DoubleSide}/></mesh>}
  </group>
}

export function RideStage(props: Props) {
  const span = Math.max(props.size[0], props.size[1]) * TILE_METRES
  const height = props.mesh?.height ?? 6
  const distance = Math.max(span * 1.9, height * 2.1, 16)
  return <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [distance * 0.8, distance * 0.55 + height * 0.3, distance * 0.9], fov: 38, near: 0.1, far: 2000 }}
    onCreated={state => props.onCanvas?.(state.gl.domElement)} aria-label="Ride preview. Drag to orbit, scroll to zoom.">
    <color attach="background" args={['#18202a']}/>
    <hemisphereLight args={['#dfeaff', '#5a5040', 1.4]}/>
    <directionalLight position={[span, span * 1.6 + height, span * 0.6]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} shadow-camera-far={span * 6 + height * 4}/>
    <group rotation-x={-Math.PI / 2}>
      <mesh position={[0, 0, -0.02]} receiveShadow><planeGeometry args={[span * 4, span * 4]}/><meshStandardMaterial color="#4f7c37" roughness={1}/></mesh>
      <Footprint size={props.size}/>
      <Ride {...props}/>
    </group>
    <OrbitControls makeDefault target={[0, Math.min(height * 0.4, 12), 0]} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={2} maxDistance={400}/>
  </Canvas>
}

/** Grabs the stage as a small WebP (PNG where WebP encoding is missing) for the build menu card. */
export async function captureThumb(canvas: HTMLCanvasElement, width = 320, height = 200): Promise<Blob | null> {
  const out = document.createElement('canvas')
  out.width = width; out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  const scale = Math.max(width / canvas.width, height / canvas.height)
  const w = canvas.width * scale, h = canvas.height * scale
  ctx.drawImage(canvas, (width - w) / 2, (height - h) / 2, w, h)
  return new Promise(resolve => out.toBlob(blob => resolve(blob), 'image/webp', 0.86))
}
