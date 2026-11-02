import { useEffect, useMemo, useState } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import { CUSTOM_LIMITS } from '../../../modules-src/maplestreet/shared/CustomItems'
import { useDevMode } from './DevModeCanvas'

const round = (value: number) => Math.round(value * 10000) / 10000
export const clampScale = (value: number) => round(Math.min(CUSTOM_LIMITS.scaleMax, Math.max(CUSTOM_LIMITS.scaleMin, Math.abs(value) || CUSTOM_LIMITS.scaleMin)))

export function EditableModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const { scale, setScale, yaw, setRawSize } = useDevMode()
  const [target, setTarget] = useState<Group | null>(null)

  const bounds = useMemo(() => {
    scene.updateMatrixWorld(true)
    scene.traverse(node => {
      const mesh = node as Mesh
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true }
    })
    const box = new Box3().setFromObject(scene)
    if (box.isEmpty()) return null
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    return { offset: [-center.x, -box.min.y, -center.z] as [number, number, number], size: { x: size.x, y: size.y, z: size.z } }
  }, [scene])

  useEffect(() => {
    setRawSize(bounds?.size ?? null)
    return () => setRawSize(null)
  }, [bounds, setRawSize])

  function onObjectChange() {
    if (!target) return
    setScale({ x: clampScale(target.scale.x), y: clampScale(target.scale.y), z: clampScale(target.scale.z) })
  }

  return <>
    <group rotation-y={yaw * (Math.PI / 2)}>
      <group ref={setTarget} scale={[scale.x, scale.y, scale.z]}>
        <group position={bounds?.offset ?? [0, 0, 0]}>
          <primitive object={scene}/>
        </group>
      </group>
    </group>
    {target && <TransformControls object={target} mode="scale" space="local" size={1.3} onObjectChange={onObjectChange}/>}
  </>
}
