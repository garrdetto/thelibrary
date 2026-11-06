import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Grid, Html, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Box3, BoxGeometry, CanvasTexture, Color, EdgesGeometry, SRGBColorSpace, Vector3 } from 'three'
import type { Group, Material, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { STOCK_CAR, STOCK_LENGTH } from '../../../../modules-src/shorttrack/shared/CustomCars'
import { numberAnchors, numberPlanes } from '../../../../modules-src/shorttrack/shared/carSurface'
import type { NumberAnchors } from '../../../../modules-src/shorttrack/shared/carSurface'
import { DentSmoother } from '../../maplestreet/vehicle/DentSmoother'
import type { SmootherApi } from '../../maplestreet/vehicle/DentSmoother'
import { maskedMap, samplePixel } from '../../maplestreet/vehicle/VehicleStage'
import { placement, turnedSize } from './carDraft'
import type { CarDraft, CarMarker, Center, Size3 } from './carDraft'

export type CarModelInfo = { raw: Size3; center: Center; materials: string[] }

type Props = {
  url: string
  draft: CarDraft
  compare: boolean
  overlap: boolean
  selected: CarMarker | null
  picking: boolean
  onInfo: (info: CarModelInfo) => void
  onMarker: (id: CarMarker, position: { x: number; y: number; z: number }) => void
  onPick: (pick: { material: string; color: string | null }) => void
  onSelect: (id: CarMarker | null) => void
  onScene?: (scene: Object3D | null) => void
  smoother?: MutableRefObject<SmootherApi | null>
  locked?: boolean
}

const MARKER_COLOR: Record<CarMarker, string> = { front: '#5cd17a', rear: '#5cd17a', door: '#4aa3ff', roof: '#4aa3ff', tail: '#4aa3ff', light: '#ff6a6a' }

let numberTexture: CanvasTexture | null = null
function sampleNumber() {
  if (numberTexture) return numberTexture
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 192
  const g = canvas.getContext('2d')!
  g.font = 'italic 900 170px system-ui, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.lineWidth = 14; g.strokeStyle = '#111111'; g.strokeText('77', 128, 100)
  g.fillStyle = '#ffffff'; g.fillText('77', 128, 100)
  numberTexture = new CanvasTexture(canvas)
  numberTexture.colorSpace = SRGBColorSpace
  return numberTexture
}

function CarModel({ url, draft, onInfo, picking, onPick, onScene, smoother, onPlaced }: Pick<Props, 'url' | 'draft' | 'onInfo' | 'picking' | 'onPick' | 'onScene' | 'smoother'> & { onPlaced: (root: Group) => void }) {
  const { scene } = useGLTF(url, false, true)
  const holder = useRef<Group>(null)
  useEffect(() => { onScene?.(scene); return () => onScene?.(null) }, [scene, onScene])
  const originals = useRef(new Map<Object3D, Material | Material[]>())
  const info = useMemo<CarModelInfo | null>(() => {
    scene.updateMatrixWorld(true)
    const names = new Set<string>()
    scene.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true; mesh.receiveShadow = true
      originals.current.set(mesh, mesh.material)
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

  const model = info ? placement(draft, info.center) : null
  useEffect(() => { if (holder.current && model) onPlaced(holder.current) }, [model?.scale, model?.yaw, model?.x, model?.y, model?.z, onPlaced])

  if (!info || !model) return null
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
  return <group ref={holder} position={[model.x, model.y, model.z]} rotation-y={(draft.yaw * Math.PI) / 2} scale={draft.scale} onClick={click}>
    <primitive object={scene}/>
    {smoother && <DentSmoother scene={scene} api={smoother}/>}
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

function Marker({ id, position, selected, onSelect }: { id: CarMarker; position: [number, number, number]; selected: boolean; onSelect: (id: CarMarker) => void }) {
  return <mesh position={position} renderOrder={10} onClick={event => { event.stopPropagation(); onSelect(id) }}>
    <sphereGeometry args={[selected ? 0.09 : 0.07, 16, 12]}/>
    <meshBasicMaterial color={MARKER_COLOR[id]} depthTest={false} transparent opacity={0.95}/>
  </mesh>
}

function StockOutline({ offsetZ }: { offsetZ: number }) {
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(STOCK_LENGTH, STOCK_CAR.height, STOCK_CAR.width)), [])
  useEffect(() => () => edges.dispose(), [edges])
  return <group position={[0, 0, offsetZ]}>
    <lineSegments geometry={edges} position={[(STOCK_CAR.front + STOCK_CAR.rear) / 2, STOCK_CAR.height / 2, 0]}>
      <lineBasicMaterial color="#f2b544"/>
    </lineSegments>
    {STOCK_CAR.axles.flatMap((a, i) => [1, -1].map(side => <mesh key={`${i}${side}`} position={[a.x, a.radius, a.halfTrack * side]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[a.radius, a.radius, a.width, 24, 1, true]}/>
      <meshBasicMaterial color="#f2b544" wireframe transparent opacity={0.6}/>
    </mesh>))}
    <Html position={[STOCK_CAR.front, STOCK_CAR.height + 0.15, 0]} center className="ms-veh-label">Stock car · {STOCK_LENGTH.toFixed(2)} m</Html>
  </group>
}

function CarScene(props: Props & { info: CarModelInfo | null; setInfo: (info: CarModelInfo) => void }) {
  const { draft, info, selected } = props
  const [target, setTarget] = useState<Group | null>(null)
  const [anchors, setAnchors] = useState<NumberAnchors | null>(null)
  const placed = useRef<Group | null>(null)
  const size = info ? turnedSize(info.raw, draft.yaw) : null
  const length = size ? size.x * draft.scale : STOCK_LENGTH
  const width = size ? size.z * draft.scale : STOCK_CAR.width
  const height = size ? size.y * draft.scale : STOCK_CAR.height
  const onPlaced = useMemo(() => (root: Group) => { placed.current = root; setAnchors(numberAnchors(root, draft.numbers)) }, [draft.numbers])
  useEffect(() => { if (placed.current) setAnchors(numberAnchors(placed.current, draft.numbers)) }, [draft.numbers])

  const pos = (id: CarMarker): [number, number, number] => {
    const n = draft.numbers
    switch (id) {
      case 'front': return [draft.axles[0].x, draft.axles[0].radius, draft.axles[0].halfTrack]
      case 'rear': return [draft.axles[1].x, draft.axles[1].radius, draft.axles[1].halfTrack]
      case 'door': return [n.door?.x ?? 0, n.door?.y ?? height / 2, anchors?.door?.right ?? width / 2]
      case 'roof': return [n.roof?.x ?? 0, anchors?.roof?.y ?? height, 0]
      case 'tail': return [anchors?.tail?.x ?? -length / 2, n.tail?.y ?? height / 2, 0]
      case 'light': return [draft.tail?.x ?? -length / 2, draft.tail?.y ?? height / 2, draft.tail?.z ?? width / 3]
    }
  }
  function changed() {
    if (!target || !selected) return
    props.onMarker(selected, { x: target.position.x, y: target.position.y, z: target.position.z })
  }
  const texture = sampleNumber()
  const planes = anchors ? numberPlanes(anchors) : []
  const shown = (['front', 'rear', 'door', 'roof', 'tail', 'light'] as const).filter(id => id === 'front' || id === 'rear' || (id === 'light' ? !!draft.tail : !!draft.numbers[id]))
  return <>
    <CarModel url={props.url} draft={draft} onInfo={props.setInfo} picking={props.picking} onPick={props.onPick} onScene={props.onScene} smoother={props.smoother} onPlaced={onPlaced}/>
    {draft.axles.map((a, i) => [1, -1].map(side => <Wheel key={`${i}${side}`} radius={a.radius} width={a.width} position={[a.x, a.radius, a.halfTrack * side]}/>))}
    {planes.map((p, i) => {
      const h = draft.numbers[p.spot]?.h ?? 0.3
      return <mesh key={i} position={p.position} rotation={p.rotation} renderOrder={4}>
        <planeGeometry args={[h * 1.75, h * 1.3]}/>
        <meshBasicMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4}/>
      </mesh>
    })}
    {draft.tail && [1, -1].map(side => <mesh key={side} position={[draft.tail!.x, draft.tail!.y, draft.tail!.z * side]}>
      <boxGeometry args={[0.05, 0.1, 0.24]}/>
      <meshStandardMaterial color="#ff1a1a" emissive="#ff1a1a" emissiveIntensity={1.4}/>
    </mesh>)}
    {shown.map(id => <Marker key={id} id={id} position={pos(id)} selected={selected === id} onSelect={props.onSelect}/>)}
    {selected && <group ref={setTarget} position={pos(selected)}/>}
    <mesh position={[length / 2 + 0.6, 0.02, 0]} rotation-z={-Math.PI / 2}>
      <coneGeometry args={[0.18, 0.4, 3]}/>
      <meshBasicMaterial color="#5cd17a"/>
    </mesh>
    {target && selected && <TransformControls object={target} mode="translate" space="world" size={0.8}
      showX={selected !== 'tail'} showY={selected === 'door' || selected === 'tail' || selected === 'light'} showZ={selected === 'front' || selected === 'rear' || selected === 'light'} onObjectChange={changed}/>}
    {props.compare && <StockOutline offsetZ={props.overlap ? 0 : width / 2 + STOCK_CAR.width / 2 + 0.8}/>}
  </>
}

export function CarStage(props: Props) {
  const [info, setInfoState] = useState<CarModelInfo | null>(null)
  const { onInfo } = props
  const setInfo = useMemo(() => (next: CarModelInfo) => { setInfoState(next); onInfo(next) }, [onInfo])
  return <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [6.5, 3.4, 7.5], fov: 40, near: 0.05, far: 500 }} aria-label="Race car preview. Click a marker to drag it, or click the model to pick its paint." onPointerMissed={() => props.onSelect(null)}>
    <color attach="background" args={['#14181d']}/>
    <hemisphereLight args={['#ffffff', '#6b6253', 1.6]}/>
    <directionalLight position={[-4, 9, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9}/>
    <Grid args={[60, 60]} cellSize={1} sectionSize={5} cellColor="#3b4450" sectionColor="#6c7a8a" fadeDistance={45} infiniteGrid position={[0, 0.001, 0]}/>
    <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.001, 0]}>
      <planeGeometry args={[80, 80]}/>
      <shadowMaterial opacity={0.35}/>
    </mesh>
    <CarScene {...props} info={info} setInfo={setInfo}/>
    <OrbitControls makeDefault enabled={!props.locked} target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2 - 0.03} minDistance={1} maxDistance={70}/>
  </Canvas>
}
