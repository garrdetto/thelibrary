/** Lofted surfaces: rings or open strips of (x, y) points at stations along z, skinned into one indexed geometry with smooth normals and per-vertex colour. */
import * as THREE from 'three/webgpu'

export type Profile = readonly (readonly [x: number, y: number])[]

export interface Station {
  z: number
  profile: Profile
  /** Vertex colour multiplier for this whole ring (1 = untouched). */
  shade?: number
  /** Per-point shade overrides, same length as the profile. */
  pointShade?: readonly number[]
}

export interface LoftOptions {
  /** Treat each station as a closed ring (last point joins the first). */
  closed: boolean
  /** Faces normally point away from the loft's centroid; flip turns them inward (for an interior surface). */
  flip?: boolean
}

/** Mirrors a half profile (given from the centre line outwards, x ≥ 0) into a full ring running left → right. */
export function mirror(half: Profile): Profile {
  const left = half.map(([x, y]) => [-x, y] as const).reverse()
  return [...left, ...half]
}

/** Linear interpolation between two profiles with the same point count. */
export function lerpProfile(a: Profile, b: Profile, t: number): Profile {
  return a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t] as const)
}

export function loft(stations: readonly Station[], options: LoftOptions): THREE.BufferGeometry {
  const count = stations[0].profile.length
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  const vertexAt = new Map<string, number>()
  const ids: number[][] = []
  const length = stations[stations.length - 1].z - stations[0].z || 1
  stations.forEach((station) => {
    const row: number[] = []
    for (let i = 0; i < count; i++) {
      const p = station.profile[i]
      const key = `${p[0].toFixed(4)}|${p[1].toFixed(4)}|${station.z.toFixed(4)}`
      let id = vertexAt.get(key)
      if (id === undefined) {
        id = positions.length / 3
        vertexAt.set(key, id)
        positions.push(p[0], p[1], station.z)
        const shade = (station.shade ?? 1) * (station.pointShade?.[i] ?? 1)
        colors.push(shade, shade, shade)
        uvs.push(i / Math.max(1, count - 1), (station.z - stations[0].z) / length)
      }
      row.push(id)
    }
    ids.push(row)
  })
  const span = options.closed ? count : count - 1
  const centroid = new THREE.Vector3()
  for (const station of stations) for (const p of station.profile) centroid.add(new THREE.Vector3(p[0], p[1], station.z))
  centroid.divideScalar(stations.length * count)
  let outward = 0
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const faces: number[][] = []
  for (let s = 0; s < stations.length - 1; s++) {
    for (let i = 0; i < span; i++) {
      const a = ids[s][i]
      const b = ids[s][(i + 1) % count]
      const c = ids[s + 1][i]
      const d = ids[s + 1][(i + 1) % count]
      for (const tri of [[a, b, c], [b, d, c]]) {
        const [x, y, z] = tri
        if (x === y || y === z || x === z) continue
        faces.push(tri)
        va.fromArray(positions, x * 3)
        vb.fromArray(positions, y * 3)
        vc.fromArray(positions, z * 3)
        normal.copy(vb).sub(va).cross(vc.clone().sub(va))
        const toFace = va.clone().add(vb).add(vc).divideScalar(3).sub(centroid)
        if (normal.lengthSq() > 1e-12) outward += Math.sign(normal.dot(toFace))
      }
    }
  }
  const reverse = (outward < 0) !== !!options.flip
  for (const [x, y, z] of faces) {
    if (reverse) index.push(x, z, y)
    else index.push(x, y, z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** A tube between two points (a pillar, a cage bar, a rail). */
export function bar(from: THREE.Vector3, to: THREE.Vector3, radius: number, segments = 8): THREE.BufferGeometry {
  const direction = to.clone().sub(from)
  const length = direction.length()
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  geometry.applyQuaternion(quaternion)
  geometry.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  return geometry
}

/** A box with rounded edges built from a lathe-free beveled profile (cheap stand-in for RoundedBoxGeometry). */
export function roundedBox(width: number, height: number, depth: number, radius: number, segments = 3): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const hw = width / 2
  const hh = height / 2
  const r = Math.min(radius, hw, hh)
  shape.moveTo(-hw + r, -hh)
  shape.lineTo(hw - r, -hh)
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r)
  shape.lineTo(hw, hh - r)
  shape.quadraticCurveTo(hw, hh, hw - r, hh)
  shape.lineTo(-hw + r, hh)
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r)
  shape.lineTo(-hw, -hh + r)
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: segments, curveSegments: 4 })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}
