import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Grid, Html, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Float32BufferAttribute, Color, DoubleSide, EdgesGeometry, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Group, Material, Object3D, Texture } from 'three'
import { cutTriangles, lampCuts, lamps3d } from '../../../../modules-src/maplestreet/shared/LampCut'
import type { Lamp3d, LampCut } from '../../../../modules-src/maplestreet/shared/LampCut'
import { lampParts } from '../../../../modules-src/maplestreet/shared/Lamps3d'
import type { LampMesh } from '../../../../modules-src/maplestreet/shared/Lamps3d'
import { lampTriangles } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { LampDepth, LampSize, Shape } from '../../../../modules-src/maplestreet/shared/Shapes'
import { recolorPixels } from '../../../../modules-src/maplestreet/shared/PaintMask'
import { BODY_EXTENTS, BUILTIN_TUNING, rideHeight } from '../../../../modules-src/maplestreet/shared/Vehicles'
import type { Draft, MarkerId, ReferenceKind, Size3 } from './draft'
import { draftRideHeight, suspensionFor, turnedCenter, turnedSize } from './draft'
import { DentSmoother } from './DentSmoother'
import type { SmootherApi } from './DentSmoother'
import { fullIndex, onFullIndexChange, setDisplayIndex } from './displayIndex'
import { groundMatrix } from './suggestRender'
import { WindowWorker } from './WindowsPanel'
import type { WindowsApi } from './WindowsPanel'

const RESIDENT_URL = '/models/maplestreet/characters/resident.glb'
const RESIDENT_HEIGHT = 1.75

export type ModelInfo = { raw: Size3; center: { x: number; z: number; minY: number }; materials: string[] }

type Props = {
  url: string
  draft: Draft
  reference: ReferenceKind | null
  overlap: boolean
  selected: MarkerId | null
  picking: boolean
  onInfo: (info: ModelInfo) => void
  onMarker: (id: MarkerId, position: { x: number; y: number; z: number }) => void
  onPick: (pick: { material: string; color: string | null }) => void
  onSelect: (id: MarkerId | null) => void
  onScene?: (scene: Object3D | null) => void
  /** Filled in once the model is open; the Body step smooths dents through it. */
  smoother?: MutableRefObject<SmootherApi | null>
  /** Filled in once the model is open; the Windows tool works through it. */
  windows?: MutableRefObject<WindowsApi | null>
  /** Holds the camera still while a selection is being drawn over the canvas. */
  locked?: boolean
}

export function samplePixel(map: Texture | null, uv: { x: number; y: number } | undefined): string | null {
  const image = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!image?.width || !uv) return null
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  const u = ((uv.x % 1) + 1) % 1, v = ((uv.y % 1) + 1) % 1
  const py = map!.flipY ? (1 - v) * image.height : v * image.height
  const [r, g, b] = ctx.getImageData(Math.min(image.width - 1, Math.floor(u * image.width)), Math.min(image.height - 1, Math.floor(py)), 1, 1).data
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

const maskCache = new Map<string, Texture>()
export function maskedMap(map: Texture, key: string, tolerance: number, color: string): Texture | null {
  const id = `${map.uuid}|${key}|${tolerance}|${color}`
  const hit = maskCache.get(id)
  if (hit) return hit
  const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!image?.width) return null
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const c = parseInt(color.slice(1), 16)
  recolorPixels(data.data, key, tolerance, [(c >> 16) & 255, (c >> 8) & 255, c & 255])
  ctx.putImageData(data, 0, 0)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = map.colorSpace; tex.flipY = map.flipY; tex.wrapS = map.wrapS; tex.wrapT = map.wrapT
  maskCache.set(id, tex)
  return tex
}

const floatPositions = new WeakMap<object, Float32Array>()

/** A geometry's positions as plain numbers (published models store them packed). */
function positionsOf(geometry: BufferGeometry): ArrayLike<number> {
  const position = geometry.getAttribute('position')
  if (position instanceof BufferAttribute && position.array instanceof Float32Array && !position.normalized) return position.array
  let plain = floatPositions.get(position)
  if (!plain) {
    plain = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) { plain[i * 3] = position.getX(i); plain[i * 3 + 1] = position.getY(i); plain[i * 3 + 2] = position.getZ(i) }
    floatPositions.set(position, plain)
  }
  return plain
}

/** Hides, in the preview only, the body's triangles that lie behind a 3D lamp's lens; the saved model keeps them. */
function hideBehindLamps(scene: Object3D, holder: Group, cuts: LampCut[]) {
  if (!holder.parent) return
  holder.parent.updateWorldMatrix(true, true)
  const toChassis = new Matrix4().copy(holder.parent.matrixWorld).invert()
  const m = new Matrix4()
  scene.traverse(node => {
    const mesh = node as Mesh
    if (!mesh.isMesh || node.userData.msHelper || !mesh.geometry?.getAttribute('position')) return
    if (!cuts.length) { setDisplayIndex(mesh.geometry, null); return }
    const kept = cutTriangles(positionsOf(mesh.geometry), fullIndex(mesh.geometry)?.array ?? null, m.multiplyMatrices(toChassis, mesh.matrixWorld).elements, cuts)
    setDisplayIndex(mesh.geometry, kept ? new BufferAttribute(kept, 1) : null)
  })
}

function VehicleModel({ url, draft, cuts, onInfo, picking, onPick, onScene, smoother, windows }: { url: string; draft: Draft; cuts: LampCut[]; onInfo: Props['onInfo']; picking: boolean; onPick: Props['onPick']; onScene?: Props['onScene']; smoother?: Props['smoother']; windows?: Props['windows'] }) {
  const { scene } = useGLTF(url, false, true)
  const invalidate = useThree(state => state.invalidate)
  const holder = useRef<Group>(null)
  const toBody = useRef<() => Matrix4>(() => new Matrix4())
  useEffect(() => { onScene?.(scene); return () => onScene?.(null) }, [scene, onScene])
  const originals = useRef(new Map<Object3D, Material | Material[]>())
  const info = useMemo<ModelInfo | null>(() => {
    scene.updateMatrixWorld(true)
    const names = new Set<string>()
    scene.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true; mesh.receiveShadow = true
      originals.current.set(mesh, mesh.material)
      mesh.userData.msOriginalMaterial = mesh.material
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.name) names.add(m.name)
    })
    const box = new Box3().setFromObject(scene)
    if (box.isEmpty()) return null
    const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3())
    return { raw: { x: size.x, y: size.y, z: size.z }, center: { x: center.x, z: center.z, minY: box.min.y }, materials: [...names] }
  }, [scene])

  useEffect(() => { if (info) onInfo(info) }, [info, onInfo])

  useEffect(() => {
    const { mode, material, key, tolerance, color } = draft.paint
    for (const [node, original] of originals.current) {
      const mesh = node as Mesh
      const mats = Array.isArray(original) ? original : [original]
      const next = mats.map(m => {
        const src = m as MeshStandardMaterial
        if (mode === 'material' && src.name === material) { const c = src.clone(); c.color = new Color(color); return c }
        if (mode === 'color' && src.map) { const map = maskedMap(src.map, key, tolerance, color); if (map) { const c = src.clone(); c.map = map; return c } }
        return src
      })
      mesh.material = Array.isArray(original) ? next : next[0]
    }
  }, [draft.paint])

  const placed = info ? `${draft.scale}|${draft.yaw}|${draft.shiftX}|${draft.lift}|${draftRideHeight(draft, turnedSize(info.raw, draft.yaw).x * draft.scale)}` : ''
  useEffect(() => {
    const apply = () => { if (holder.current) { hideBehindLamps(scene, holder.current, cuts); invalidate() } }
    apply()
    const stop = onFullIndexChange(apply)
    return () => {
      stop()
      scene.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh && mesh.geometry) setDisplayIndex(mesh.geometry, null) })
    }
  }, [scene, cuts, placed, invalidate])

  if (!info) return null
  toBody.current = () => groundMatrix(draft, info.center)
  const turned = turnedCenter(info.center, draft.yaw)
  const length = turnedSize(info.raw, draft.yaw).x * draft.scale
  const ride = draftRideHeight(draft, length)
  function click(event: ThreeEvent<MouseEvent>) {
    if (!picking) return
    event.stopPropagation()
    const mesh = event.object as Mesh
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const index = event.face?.materialIndex ?? 0
    const original = originals.current.get(mesh)
    const src = (Array.isArray(original) ? original[index] : original ?? mats[index]) as MeshStandardMaterial
    onPick({ material: src?.name ?? '', color: samplePixel(src?.map ?? null, event.uv) ?? (src?.color ? `#${src.color.getHexString()}` : null) })
  }
  return <group ref={holder} position={[-turned.x * draft.scale + draft.shiftX, -ride + draft.lift - info.center.minY * draft.scale, -turned.z * draft.scale]} rotation-y={(draft.yaw * Math.PI) / 2} scale={draft.scale} onClick={click}>
    <primitive object={scene}/>
    {smoother && <DentSmoother scene={scene} api={smoother}/>}
    {windows && <WindowWorker scene={scene} api={windows} toBody={toBody}/>}
  </group>
}

function lampGeometry(part: LampMesh) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(part.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(part.normals, 3))
  return geometry
}

/** One 3D lamp as the games build it: a reflector bowl in the body, a glowing bulb, a lens over the opening and a trim ring. */
function Lamp3dPreview({ lamp }: { lamp: Lamp3d }) {
  const parts = useMemo(() => {
    const built = lampParts(lamp.p, lamp.shape, lamp.side, lamp.size, lamp.depth, lamp.facing, lamp.style)
    return { housing: lampGeometry(built.housing), glow: lampGeometry(built.glow), bezel: lampGeometry(built.bezel), lens: lampGeometry(built.lens) }
  }, [lamp])
  useEffect(() => () => { for (const geometry of Object.values(parts)) geometry.dispose() }, [parts])
  const tail = lamp.kind === 'tail'
  return <group>
    <mesh geometry={parts.housing}><meshStandardMaterial color={tail ? '#e6b4b4' : '#eef1f5'} metalness={0.35} roughness={0.18} side={DoubleSide}/></mesh>
    <mesh geometry={parts.glow}><meshStandardMaterial color={tail ? '#ff2a2a' : '#fff4d6'} emissive={tail ? '#ff1a1a' : '#fff4d6'} emissiveIntensity={1.6}/></mesh>
    <mesh geometry={parts.bezel}><meshStandardMaterial color="#2b2e33" metalness={0.5} roughness={0.3} side={DoubleSide}/></mesh>
    <mesh geometry={parts.lens} renderOrder={4}><meshStandardMaterial color={tail ? '#d21a1a' : '#ffffff'} transparent opacity={tail ? 0.5 : 0.16} roughness={0.05} depthWrite={false}/></mesh>
  </group>
}

function Wheel({ radius, width, position }: { radius: number; width: number; position: [number, number, number] }) {
  return <group position={position}>
    <mesh rotation-x={Math.PI / 2} castShadow>
      <cylinderGeometry args={[radius, radius, width, 28]}/>
      <meshStandardMaterial color="#171717" roughness={0.9}/>
    </mesh>
    <mesh rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[radius * 0.62, radius * 0.62, width * 1.02, 20]}/>
      <meshStandardMaterial color="#b7bcc2" metalness={0.9} roughness={0.25}/>
    </mesh>
  </group>
}

function SeatedFigure() {
  const skin = <meshStandardMaterial color="#c99a7a" roughness={0.8}/>
  const cloth = <meshStandardMaterial color="#3f6fa8" roughness={0.85}/>
  return <group>
    <mesh position={[-0.02, 0.32, 0]}><capsuleGeometry args={[0.16, 0.36, 4, 10]}/>{cloth}</mesh>
    <mesh position={[0, 0.74, 0]}><sphereGeometry args={[0.11, 16, 12]}/>{skin}</mesh>
    {[-0.1, 0.1].map(z => <group key={z}>
      <mesh position={[0.22, 0.02, z]} rotation-z={Math.PI / 2}><capsuleGeometry args={[0.07, 0.34, 4, 8]}/>{cloth}</mesh>
      <mesh position={[0.43, -0.22, z]}><capsuleGeometry args={[0.06, 0.36, 4, 8]}/>{cloth}</mesh>
      <mesh position={[0.18, 0.36, z * 2.1]} rotation-z={-1.1}><capsuleGeometry args={[0.045, 0.34, 4, 8]}/>{skin}</mesh>
    </group>)}
  </group>
}

function Marker({ id, position, selected, onSelect, color, children }: { id: MarkerId; position: [number, number, number]; selected: boolean; onSelect: (id: MarkerId) => void; color: string; children?: ReactNode }) {
  return <group position={position} onClick={event => { event.stopPropagation(); onSelect(id) }}>
    {children}
    <mesh renderOrder={10}>
      <sphereGeometry args={[selected ? 0.09 : 0.07, 16, 12]}/>
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95}/>
    </mesh>
  </group>
}

function PartBoxes({ draft, width }: { draft: Draft; width: number }) {
  const half = width / 2
  const boxes: { key: string; box: { front: number; back: number; bottom: number; top: number }; z0: number; z1: number; color: string }[] = []
  draft.parts.doors.forEach((box, i) => { for (const side of [1, -1]) boxes.push({ key: `d${i}${side}`, box, z0: side * half * 0.55, z1: side * (half + 0.03), color: '#4aa3ff' }) })
  if (draft.parts.hood) boxes.push({ key: 'hood', box: draft.parts.hood, z0: -half * 0.97, z1: half * 0.97, color: '#5cd17a' })
  if (draft.parts.trunk) boxes.push({ key: 'trunk', box: draft.parts.trunk, z0: -half * 0.97, z1: half * 0.97, color: '#f2b544' })
  return <>{boxes.map(({ key, box, z0, z1, color }) => <mesh key={key} position={[(box.front + box.back) / 2, (box.top + box.bottom) / 2, (z0 + z1) / 2]} renderOrder={5}>
    <boxGeometry args={[box.front - box.back, box.top - box.bottom, Math.abs(z1 - z0)]}/>
    <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false}/>
  </mesh>)}</>
}

function ReferenceOutline({ kind, offsetZ }: { kind: ReferenceKind; offsetZ: number }) {
  const ext = BODY_EXTENTS[kind]
  const t = BUILTIN_TUNING[kind]
  const ride = rideHeight(t)
  const length = ext.front - ext.rear
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(length, ext.height, ext.width)), [length, ext.height, ext.width])
  useEffect(() => () => edges.dispose(), [edges])
  return <group position={[0, 0, offsetZ]}>
    <lineSegments geometry={edges} position={[(ext.front + ext.rear) / 2, ext.height / 2, 0]}>
      <lineBasicMaterial color="#f2b544"/>
    </lineSegments>
    {t.axles.flatMap((a, i) => [1, -1].map(side => <mesh key={`${i}${side}`} position={[a.x, ride + t.wheelY - t.suspension.rest * 0.8, a.halfTrack * side]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[a.radius, a.radius, a.width, 24, 1, true]}/>
      <meshBasicMaterial color="#f2b544" wireframe transparent opacity={0.6}/>
    </mesh>))}
    <Html position={[ext.front, ext.height + 0.15, 0]} center className="ms-veh-label">{length.toFixed(2)} m</Html>
  </group>
}

function Resident({ z }: { z: number }) {
  const { scene } = useGLTF(RESIDENT_URL)
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const h = box.getSize(new Vector3()).y
    const scale = h > 1.5 && h < 2.05 ? 1 : RESIDENT_HEIGHT / Math.max(0.01, h)
    return { scale, y: -box.min.y * scale, height: h * scale }
  }, [scene])
  return <group position={[0, fit.y, z]} scale={fit.scale}>
    <primitive object={scene}/>
    <Html position={[0, fit.height / fit.scale + 0.12 / fit.scale, 0]} center className="ms-veh-label">{fit.height.toFixed(2)} m</Html>
  </group>
}

function ChassisScene(props: Props & { info: ModelInfo | null; setInfo: (info: ModelInfo) => void }) {
  const { draft, info, selected } = props
  const [target, setTarget] = useState<Group | null>(null)
  const size = info ? turnedSize(info.raw, draft.yaw) : null
  const length = size ? size.x * draft.scale : 4
  const width = size ? size.z * draft.scale : 1.8
  const s = suspensionFor(draft, length)
  const ride = draftRideHeight(draft, length)
  const wheelCenterY = s.wheelY - s.rest * 0.8
  const pos = (id: MarkerId): [number, number, number] => {
    switch (id) {
      case 'front': return [draft.axles[0].x, wheelCenterY, draft.axles[0].halfTrack]
      case 'rear': return [draft.axles[1].x, wheelCenterY, draft.axles[1].halfTrack]
      case 'seat': return [draft.seat.x, draft.seat.y, draft.seat.z]
      case 'head': return [draft.head.x, draft.head.y, draft.head.z]
      case 'tail': return [draft.tail.x, draft.tail.y, draft.tail.z]
      case 'hitch': return [draft.hitch?.x ?? -length / 2, draft.hitch?.y ?? 0, 0]
    }
  }
  function changed() {
    if (!target || !selected) return
    props.onMarker(selected, { x: target.position.x, y: target.position.y, z: target.position.z })
  }
  const lamps = useMemo(() => lamps3d({ head: draft.headOn ? [draft.head] : [], tail: draft.tailOn ? [draft.tail] : [] }, draft.lampShapes), [draft.head, draft.tail, draft.headOn, draft.tailOn, draft.lampShapes])
  const cuts = useMemo(() => lampCuts(lamps), [lamps])
  const flat = (kind: 'head' | 'tail') => (kind === 'head' ? draft.headOn : draft.tailOn) && (kind === 'head' ? draft.lampShapes.headStyle : draft.lampShapes.tailStyle)?.kind !== '3d'
  const lamp = (p: { x: number; y: number; z: number }, color: string, out: 1 | -1, shape?: Shape, size?: LampSize, depth?: LampDepth) => (p.z === 0 ? [1] : [1, -1]).map(side => shape
    ? <LampPlate key={side} p={p} side={side as 1 | -1} shape={shape} size={size} depth={depth} out={out} color={color}/>
    : <mesh key={side} position={[p.x, p.y, p.z * side]}>
      <boxGeometry args={[0.05, 0.11, 0.22]}/>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4}/>
    </mesh>)
  return <>
    <group position={[0, ride, 0]}>
      <VehicleModel url={props.url} draft={draft} cuts={cuts} onInfo={props.setInfo} picking={props.picking} onPick={props.onPick} onScene={props.onScene} smoother={props.smoother} windows={props.windows}/>
      {draft.axles.map((a, i) => [1, -1].map(side => <Wheel key={`${i}${side}`} radius={a.radius} width={a.width} position={[a.x, wheelCenterY, a.halfTrack * side]}/>))}
      <group position={[draft.seat.x, draft.seat.y, draft.seat.z]}><SeatedFigure/></group>
      {flat('head') && lamp(draft.head, '#fff4d6', 1, draft.lampShapes.head, draft.lampShapes.headSize, draft.lampShapes.headDepth)}
      {flat('tail') && lamp(draft.tail, '#ff1a1a', -1, draft.lampShapes.tail, draft.lampShapes.tailSize, draft.lampShapes.tailDepth)}
      {lamps.map(item => <Lamp3dPreview key={`${item.kind}${item.side}`} lamp={item}/>)}
      {draft.hitch && <mesh position={[draft.hitch.x, draft.hitch.y, 0]}><sphereGeometry args={[0.05, 12, 10]}/><meshStandardMaterial color="#dadada" metalness={1} roughness={0.15}/></mesh>}
      <Marker id="front" position={pos('front')} selected={selected === 'front'} onSelect={props.onSelect} color="#5cd17a"/>
      <Marker id="rear" position={pos('rear')} selected={selected === 'rear'} onSelect={props.onSelect} color="#5cd17a"/>
      <Marker id="seat" position={pos('seat')} selected={selected === 'seat'} onSelect={props.onSelect} color="#4aa3ff"/>
      {draft.headOn && <Marker id="head" position={pos('head')} selected={selected === 'head'} onSelect={props.onSelect} color="#fff4a8"/>}
      {draft.tailOn && <Marker id="tail" position={pos('tail')} selected={selected === 'tail'} onSelect={props.onSelect} color="#ff6a6a"/>}
      <PartBoxes draft={draft} width={width}/>
      {draft.hitch && <Marker id="hitch" position={pos('hitch')} selected={selected === 'hitch'} onSelect={props.onSelect} color="#c9a0ff"/>}
      {selected && <group ref={setTarget} position={pos(selected)}/>}
      <mesh position={[length / 2 + 0.6, -ride + 0.02, 0]} rotation-z={-Math.PI / 2}>
        <coneGeometry args={[0.18, 0.4, 3]}/>
        <meshBasicMaterial color="#5cd17a"/>
      </mesh>
    </group>
    {target && selected && <TransformControls object={target} mode="translate" space="local" size={0.8} showY={selected !== 'front' && selected !== 'rear'} showZ={selected !== 'hitch'} onObjectChange={changed}/>}
    {props.reference && <ReferenceOutline kind={props.reference} offsetZ={props.overlap ? 0 : width / 2 + BODY_EXTENTS[props.reference].width / 2 + 0.8}/>}
    <Resident z={-(width / 2 + 1.1)}/>
  </>
}

function LampPlate({ p, side, shape, size, depth, out, color }: { p: { x: number; y: number; z: number }; side: 1 | -1; shape: Shape; size?: LampSize; depth?: LampDepth; out: 1 | -1; color: string }) {
  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(lampTriangles(p, shape, side, size, depth, out), 3))
    geo.computeVertexNormals()
    return geo
  }, [p.x, p.y, p.z, side, shape, size?.w, size?.h, depth, out])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry}><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4}/></mesh>
}

export function VehicleStage(props: Props) {
  const [info, setInfoState] = useState<ModelInfo | null>(null)
  const { onInfo } = props
  const setInfo = useMemo(() => (next: ModelInfo) => { setInfoState(next); onInfo(next) }, [onInfo])
  return <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [6.5, 3.6, 7.5], fov: 40, near: 0.05, far: 500 }} aria-label="Vehicle preview. Click a marker to drag it, or click the model to pick its paint." onPointerMissed={() => props.onSelect(null)}>
    <color attach="background" args={['#14181d']}/>
    <hemisphereLight args={['#ffffff', '#6b6253', 1.6]}/>
    <directionalLight position={[-4, 9, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9}/>
    <Grid args={[60, 60]} cellSize={1} sectionSize={5} cellColor="#3b4450" sectionColor="#6c7a8a" fadeDistance={45} infiniteGrid position={[0, 0.001, 0]}/>
    <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.001, 0]}>
      <planeGeometry args={[80, 80]}/>
      <shadowMaterial opacity={0.35}/>
    </mesh>
    <ChassisScene {...props} info={info} setInfo={setInfo}/>
    <OrbitControls makeDefault enabled={!props.locked} target={[0, 0.8, 0]} maxPolarAngle={Math.PI / 2 - 0.03} minDistance={1} maxDistance={70}/>
  </Canvas>
}

useGLTF.preload(RESIDENT_URL)
