/** Bakes a static group's plain meshes into one mesh per material, so a building of hundreds of parts draws in a handful of calls. */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function prepared(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone()
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
  g.applyMatrix4(matrix)
  return g
}

/** Replaces every plain mesh under `root` (except those marked `keep`) with merged meshes; returns how many draws it saved. */
export function mergeStatic(root: THREE.Object3D, shadows = true): number {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const groups = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; cast: boolean }>()
  const remove: THREE.Mesh[] = []
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || mesh.userData.keep) return
    let parent: THREE.Object3D | null = mesh.parent
    while (parent && parent !== root) { if (parent.userData.keep) return; parent = parent.parent }
    const matrix = inverse.clone().multiply(mesh.matrixWorld)
    const entry = groups.get(mesh.material) ?? { geometries: [], cast: false }
    entry.geometries.push(prepared(mesh.geometry, matrix))
    entry.cast ||= mesh.castShadow
    groups.set(mesh.material, entry)
    remove.push(mesh)
  })
  for (const mesh of remove) mesh.removeFromParent()
  for (const [material, entry] of groups) {
    const merged = mergeGeometries(entry.geometries, false)
    for (const g of entry.geometries) g.dispose()
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = shadows && entry.cast
    mesh.receiveShadow = true
    root.add(mesh)
  }
  return remove.length - groups.size
}
