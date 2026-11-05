import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4 } from 'three'
import type { Mesh } from 'three'
import type { CustomRideMotion } from '../../../../server/park/index.mjs'
import type { RideMesh } from '@/lib/park/rideMesh'
import { motionMatrix } from '@/lib/park/rideMotion'
import { TILE_METRES } from './bake'

type Props = {
  mesh: RideMesh | null
  motion: CustomRideMotion
  size: [number, number]
  rideTime: number
  loadTime: number
  playing: boolean
  guides: boolean
  onCanvas?: (canvas: HTMLCanvasElement | null) => void
}

const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

function partGeometry(mesh: RideMesh, part: 0 | 1) {
  let count = 0
  for (let t = 0; t < mesh.triangles; t++) if (mesh.parts[t * 3] === part) count++
  if (!count) return null
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
  return geometry
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

function Ride({ mesh, motion, rideTime, loadTime, playing, guides, size }: Omit<Props, 'onCanvas'>) {
  const base = useMemo(() => mesh ? partGeometry(mesh, 0) : null, [mesh])
  const moving = useMemo(() => mesh ? partGeometry(mesh, 1) : null, [mesh])
  useEffect(() => () => { base?.dispose(); moving?.dispose() }, [base, moving])
  const movingRef = useRef<Mesh>(null)
  const clock = useRef({ phase: 'loading', timer: 0, spin: 0, speed: 0 })
  const matrix = useMemo(() => new Matrix4(), [])

  useFrame((_, delta) => {
    const c = clock.current, dt = Math.min(0.1, delta)
    if (!playing) { c.phase = 'loading'; c.timer = 0; c.speed = 0 }
    else {
      c.timer += dt
      if (c.phase === 'loading' && c.timer > loadTime) { c.phase = 'running'; c.timer = 0 }
      else if (c.phase === 'running' && c.timer > rideTime) { c.phase = 'loading'; c.timer = 0 }
    }
    const running = c.phase === 'running'
    if (running) { c.spin += dt * Math.min(1, c.speed); c.speed = Math.min(1, c.speed + dt * 0.25) }
    else { c.speed = Math.max(0, c.speed - dt * 0.6); c.spin += dt * c.speed }
    if (movingRef.current && mesh) {
      matrix.fromArray(motionMatrix(motion, { spin: c.spin, timer: c.timer, running, speed: c.speed }, rideTime, mesh.height))
      movingRef.current.matrix.copy(matrix)
    }
  })

  const span = Math.max(size[0], size[1]) * TILE_METRES
  return <group>
    {base && <mesh geometry={base} castShadow receiveShadow><meshStandardMaterial vertexColors roughness={0.72} metalness={0.05} side={DoubleSide}/></mesh>}
    {moving && <mesh ref={movingRef} geometry={moving} matrixAutoUpdate={false} castShadow receiveShadow><meshStandardMaterial vertexColors roughness={0.68} metalness={0.08} side={DoubleSide}/></mesh>}
    {guides && motion.type !== 'none' && <>
      <mesh position={[0, 0, motion.split]}><planeGeometry args={[span, span]}/><meshBasicMaterial color="#4cc3ff" transparent opacity={0.14} depthWrite={false} side={DoubleSide}/></mesh>
      {motion.type !== 'drop' && motion.type !== 'bob' && <mesh position={motion.pivot}><sphereGeometry args={[Math.max(0.25, span * 0.012), 16, 12]}/><meshBasicMaterial color="#ff5c8a"/></mesh>}
    </>}
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
