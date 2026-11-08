/** Instanced grass tufts over a lot's open lawn, swaying a little in the wind. */
import * as THREE from 'three/webgpu'
import { float, instanceIndex, positionLocal, sin, time, vec3 } from 'three/tsl'
import { D, LotGrid, W, tileIndex } from '../../shared/Lot'

const TUFTS_PER_TILE = 14

function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const base = new THREE.Color('#3f6a2a')
  const tip = new THREE.Color('#9ccb63')
  for (let blade = 0; blade < 5; blade++) {
    const a = (blade / 5) * Math.PI + 0.3
    const lean = 0.35 + (blade % 3) * 0.1
    const h = 0.11 + (blade % 2) * 0.05
    const w = 0.018
    const cx = Math.cos(a) * 0.04, cz = Math.sin(a) * 0.04
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w
    positions.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx * (1 + lean * 3), h, cz * (1 + lean * 3))
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function buildGrass(grid: LotGrid, still: boolean): THREE.InstancedMesh {
  const open: [number, number][] = []
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const i = tileIndex(x, z)
    if (grid.inside[i] || grid.floors[i] !== -1 || grid.occupied[i] !== -1) continue
    open.push([x, z])
  }
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })
  if (!still) {
    const phase = float(instanceIndex).mul(0.37)
    const sway = sin(time.mul(1.8).add(phase)).mul(positionLocal.y).mul(0.35)
    material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)))
  }
  const geometry = tuftGeometry()
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, open.length * TUFTS_PER_TILE))
  mesh.userData.ownMaterial = material
  mesh.receiveShadow = true
  mesh.castShadow = false
  let seed = 1234567
  const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const tint = new THREE.Color()
  let n = 0
  for (const [x, z] of open) {
    for (let k = 0; k < TUFTS_PER_TILE; k++) {
      const s = 0.7 + random() * 0.8
      q.setFromAxisAngle(up, random() * Math.PI * 2)
      m.compose(new THREE.Vector3(x + random(), 0.02, z + random()), q, new THREE.Vector3(s, s * (0.8 + random() * 0.6), s))
      mesh.setMatrixAt(n, m)
      tint.setHSL(0.2 + random() * 0.08, 0.35 + random() * 0.2, 0.72 + random() * 0.2)
      mesh.setColorAt(n, tint)
      n++
    }
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}
