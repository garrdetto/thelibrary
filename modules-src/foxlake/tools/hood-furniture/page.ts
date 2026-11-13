/**
 * Runs in a browser page: builds every item in The Hood's catalog with The Hood's own furniture code (its Blender
 * models where it has them, its procedural builders otherwise) and returns each as triangle lists per material,
 * in the item's own metres (centred on its footprint, front toward -z), for `export-hood-furniture.mjs` to write.
 */
import * as THREE from 'three/webgpu'
import { CATALOG } from '../../../hood/shared/Catalog'
import { buildFurniture } from '../../../hood/src/models/Furniture'
import { loadModels } from '../../../hood/src/models/Models'

interface OutMaterial { key: string; surface: string | null; size: number; color: number[]; roughness: number; metalness: number; emissive: number[]; emissiveIntensity: number; opacity: number; doubleSided: boolean }
interface OutPart { material: OutMaterial; positions: number[]; normals: number[]; uvs: number[] }
export interface OutItem { id: string; parts: OutPart[] }

function describe(m: THREE.MeshStandardMaterial): OutMaterial {
  const surface = (m.userData.surface as { name: string; size: number } | undefined) ?? null
  const color = m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1]
  const emissive = m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : [0, 0, 0]
  const opacity = m.transparent ? m.opacity : 1
  const out = { surface: surface?.name ?? null, size: surface?.size ?? 1, color, roughness: m.roughness ?? 0.7, metalness: m.metalness ?? 0, emissive, emissiveIntensity: m.emissiveIntensity ?? 0, opacity, doubleSided: m.side === THREE.DoubleSide }
  return { key: JSON.stringify(out), ...out }
}

function collect(def: (typeof CATALOG)[number]): OutItem {
  const group = buildFurniture(def)
  group.updateMatrixWorld(true)
  const parts = new Map<string, OutPart>()
  const normalMatrix = new THREE.Matrix3()
  const p = new THREE.Vector3(), n = new THREE.Vector3()
  group.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const geometry = mesh.geometry
    const pos = geometry.getAttribute('position')
    const nor = geometry.getAttribute('normal')
    if (!pos) return
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    const index = geometry.getIndex()
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }]
    const flip = mesh.matrixWorld.determinant() < 0
    for (const g of groups) {
      const material = materials[g.materialIndex ?? 0] as THREE.MeshStandardMaterial
      if (!material) continue
      const desc = describe(material)
      let part = parts.get(desc.key)
      if (!part) parts.set(desc.key, (part = { material: desc, positions: [], normals: [], uvs: [] }))
      const size = desc.size || 1
      for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
        const tri = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k))
        if (flip) tri.reverse()
        for (const i of tri) {
          p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
          if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
          else n.set(0, 1, 0)
          part.positions.push(p.x, p.y, p.z)
          part.normals.push(n.x, n.y, n.z)
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z)
          if (ay >= ax && ay >= az) part.uvs.push(p.x / size, p.z / size)
          else if (ax >= az) part.uvs.push(p.z / size, p.y / size)
          else part.uvs.push(p.x / size, p.y / size)
        }
      }
    }
  })
  return { id: def.id, parts: [...parts.values()] }
}

declare global { interface Window { exportHood: () => Promise<OutItem[]> } }

window.exportHood = async () => {
  await loadModels()
  return CATALOG.map(collect)
}
