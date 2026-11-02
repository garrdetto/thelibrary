import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { EdgesGeometry, PlaneGeometry } from 'three'
import type { Vector3Like } from '@/lib/maplestreet-items'

export type DevModeState = {
  scale: Vector3Like
  setScale: (scale: Vector3Like) => void
  yaw: number
  rawSize: Vector3Like | null
  setRawSize: (size: Vector3Like | null) => void
  footprint: { w: number; d: number; h: number } | null
}

const DevModeContext = createContext<DevModeState | null>(null)

export function useDevMode() {
  const value = useContext(DevModeContext)
  if (!value) throw new Error('useDevMode must be used inside DevModeCanvas.')
  return value
}

function FootprintOutline({ w, d }: { w: number; d: number }) {
  const edges = useMemo(() => new EdgesGeometry(new PlaneGeometry(w, d).rotateX(-Math.PI / 2)), [w, d])
  useEffect(() => () => edges.dispose(), [edges])
  return <group>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, 0]}>
      <planeGeometry args={[w, d]}/>
      <meshBasicMaterial color="#f2b544" transparent opacity={0.18} depthWrite={false}/>
    </mesh>
    <lineSegments geometry={edges} position={[0, 0.006, 0]}>
      <lineBasicMaterial color="#f2b544"/>
    </lineSegments>
  </group>
}

export function DevModeCanvas({ state, children }: { state: DevModeState; children: ReactNode }) {
  const footprint = state.footprint
  const cellOffset = useMemo<[number, number, number]>(() => footprint ? [(footprint.w % 2) * 0.5, 0, (footprint.d % 2) * 0.5] : [0, 0, 0], [footprint])
  return <DevModeContext.Provider value={state}>
    <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [4.5, 3.4, 5.5], fov: 40, near: 0.05, far: 500 }} aria-label="Model preview. Drag the scale handles to resize the model.">
      <color attach="background" args={['#14181d']}/>
      <hemisphereLight args={['#ffffff', '#6b6253', 1.6]}/>
      <directionalLight position={[-4, 8, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}/>
      <Grid args={[40, 40]} cellSize={1} sectionSize={4} cellColor="#3b4450" sectionColor="#6c7a8a" fadeDistance={36} infiniteGrid position={[0, 0.001, 0]}/>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.001, 0]}>
        <planeGeometry args={[60, 60]}/>
        <shadowMaterial opacity={0.35}/>
      </mesh>
      <group position={cellOffset}>
        {footprint && <FootprintOutline w={footprint.w} d={footprint.d}/>}
        {children}
      </group>
      <OrbitControls makeDefault target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={0.5} maxDistance={60}/>
    </Canvas>
  </DevModeContext.Provider>
}
