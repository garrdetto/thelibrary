import type { BufferAttribute, BufferGeometry } from 'three'

/**
 * Welded view of one geometry: vertices at the same position (UV and normal
 * seams) share a cluster, so smoothing never tears the surface open.
 */
export type Topology = {
  clusterOf: Int32Array
  clusters: number[][]
  neighbours: number[][]
  /** Non-degenerate triangles as cluster indices (3 per face). */
  faces: Int32Array
  /** The same triangles as vertex indices. */
  corners: Int32Array
  /** Faces around each cluster (CSR: faces of cluster c are list[start[c]..start[c+1]]). */
  clusterFaceStart: Int32Array
  clusterFaceList: Int32Array
  /** Faces using each vertex directly. */
  vertexFaceStart: Int32Array
  vertexFaceList: Int32Array
  /** 1 for clusters on an open edge of the mesh; they are never moved. */
  boundary: Uint8Array
}

const topologies = new WeakMap<BufferGeometry, Topology>()

function faceIndex(count: number, items: Int32Array): [Int32Array, Int32Array] {
  const start = new Int32Array(count + 1)
  for (let i = 0; i < items.length; i++) start[items[i] + 1]++
  for (let i = 0; i < count; i++) start[i + 1] += start[i]
  const fill = start.slice(0, count)
  const list = new Int32Array(items.length)
  for (let i = 0; i < items.length; i++) list[fill[items[i]]++] = (i / 3) | 0
  return [start, list]
}

export function topology(geometry: BufferGeometry): Topology {
  const hit = topologies.get(geometry)
  if (hit) return hit
  const pos = geometry.getAttribute('position') as BufferAttribute
  const count = pos.count
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const span = Math.max(1e-6, box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  const q = 1e5 / span
  const byKey = new Map<string, number>()
  const clusterOf = new Int32Array(count)
  const clusters: number[][] = []
  for (let i = 0; i < count; i++) {
    const key = `${Math.round((pos.getX(i) - box.min.x) * q)},${Math.round((pos.getY(i) - box.min.y) * q)},${Math.round((pos.getZ(i) - box.min.z) * q)}`
    let id = byKey.get(key)
    if (id === undefined) { id = clusters.length; byKey.set(key, id); clusters.push([]) }
    clusters[id].push(i)
    clusterOf[i] = id
  }
  const index = geometry.getIndex()
  const total = index ? index.count : count
  const faceList: number[] = []
  const cornerList: number[] = []
  for (let t = 0; t + 2 < total; t += 3) {
    const va = index ? index.getX(t) : t, vb = index ? index.getX(t + 1) : t + 1, vc = index ? index.getX(t + 2) : t + 2
    const a = clusterOf[va], b = clusterOf[vb], c = clusterOf[vc]
    if (a === b || b === c || a === c) continue
    faceList.push(a, b, c)
    cornerList.push(va, vb, vc)
  }
  const faces = Int32Array.from(faceList)
  const corners = Int32Array.from(cornerList)
  const sets = clusters.map(() => new Set<number>())
  const edges = new Map<number, number>()
  const n = clusters.length
  const edge = (a: number, b: number) => { const k = a < b ? a * n + b : b * n + a; edges.set(k, (edges.get(k) ?? 0) + 1) }
  for (let t = 0; t + 2 < faces.length; t += 3) {
    const a = faces[t], b = faces[t + 1], c = faces[t + 2]
    sets[a].add(b); sets[b].add(a); sets[b].add(c); sets[c].add(b); sets[a].add(c); sets[c].add(a)
    edge(a, b); edge(b, c); edge(a, c)
  }
  const boundary = new Uint8Array(n)
  for (const [k, uses] of edges) if (uses === 1) { boundary[Math.floor(k / n)] = 1; boundary[k % n] = 1 }
  const [clusterFaceStart, clusterFaceList] = faceIndex(n, faces)
  const [vertexFaceStart, vertexFaceList] = faceIndex(count, corners)
  const out: Topology = { clusterOf, clusters, neighbours: sets.map(s => [...s]), faces, corners, clusterFaceStart, clusterFaceList, vertexFaceStart, vertexFaceList, boundary }
  topologies.set(geometry, out)
  return out
}

/** Area-weighted (unnormalized) and unit normals, areas and centroids of every face. */
export function faceGeometry(topo: Topology, p: Float32Array) {
  const f = topo.faces
  const faces = f.length / 3
  const weighted = new Float32Array(faces * 3)
  const unit = new Float32Array(faces * 3)
  const area = new Float32Array(faces)
  const centroid = new Float32Array(faces * 3)
  for (let i = 0; i < faces; i++) {
    const a = f[i * 3] * 3, b = f[i * 3 + 1] * 3, c = f[i * 3 + 2] * 3
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2]
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2]
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const l = Math.hypot(nx, ny, nz)
    weighted[i * 3] = nx; weighted[i * 3 + 1] = ny; weighted[i * 3 + 2] = nz
    if (l > 0) { unit[i * 3] = nx / l; unit[i * 3 + 1] = ny / l; unit[i * 3 + 2] = nz / l }
    area[i] = l / 2
    centroid[i * 3] = (p[a] + p[b] + p[c]) / 3
    centroid[i * 3 + 1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3
    centroid[i * 3 + 2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3
  }
  return { weighted, unit, area, centroid }
}

/** Area-weighted normal per cluster from the given local positions. */
export function clusterNormals(topo: Topology, p: Float32Array) {
  const n = new Float32Array(topo.clusters.length * 3)
  const { weighted } = faceGeometry(topo, p)
  const f = topo.faces
  for (let t = 0; t < f.length; t++) {
    const k = f[t] * 3, face = ((t / 3) | 0) * 3
    n[k] += weighted[face]; n[k + 1] += weighted[face + 1]; n[k + 2] += weighted[face + 2]
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return n
}

/** Each cluster's neighbours across edges no sharper than the crease angle. */
export function creaseLinks(topo: Topology, normals: Float32Array, creaseDeg: number, include: (c: number) => boolean) {
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180)
  const links: number[][] = new Array(topo.clusters.length)
  for (let c = 0; c < topo.clusters.length; c++) {
    if (!include(c)) continue
    links[c] = topo.neighbours[c].filter(n => normals[c * 3] * normals[n * 3] + normals[c * 3 + 1] * normals[n * 3 + 1] + normals[c * 3 + 2] * normals[n * 3 + 2] >= cosLimit)
  }
  return links
}

/**
 * Crease-aware vertex normals, like an auto-smooth angle: each vertex averages
 * the faces around its welded point that lie on its own side of any edge
 * sharper than the crease angle. Only clusters flagged in `only` are rewritten.
 */
export function writeVertexNormals(topo: Topology, p: Float32Array, creaseDeg: number, out: Float32Array, only: Uint8Array | null) {
  const { weighted, unit } = faceGeometry(topo, p)
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180)
  for (let c = 0; c < topo.clusters.length; c++) {
    if (only && !only[c]) continue
    for (const v of topo.clusters[c]) {
      let rx = 0, ry = 0, rz = 0
      for (let k = topo.vertexFaceStart[v]; k < topo.vertexFaceStart[v + 1]; k++) {
        const f = topo.vertexFaceList[k] * 3
        rx += weighted[f]; ry += weighted[f + 1]; rz += weighted[f + 2]
      }
      const rl = Math.hypot(rx, ry, rz)
      if (!rl) continue
      rx /= rl; ry /= rl; rz /= rl
      let nx = 0, ny = 0, nz = 0
      for (let k = topo.clusterFaceStart[c]; k < topo.clusterFaceStart[c + 1]; k++) {
        const f = topo.clusterFaceList[k] * 3
        if (unit[f] * rx + unit[f + 1] * ry + unit[f + 2] * rz < cosLimit) continue
        nx += weighted[f]; ny += weighted[f + 1]; nz += weighted[f + 2]
      }
      const l = Math.hypot(nx, ny, nz)
      if (!l) { nx = rx; ny = ry; nz = rz } else { nx /= l; ny /= l; nz /= l }
      out[v * 3] = nx; out[v * 3 + 1] = ny; out[v * 3 + 2] = nz
    }
  }
}
