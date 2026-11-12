import { clusterNormals, creaseLinks, faceGeometry } from './meshTopology'
import type { Topology } from './meshTopology'

export type SmoothMethod = 'clean' | 'even' | 'fill'

export const SMOOTH_METHODS: Record<SmoothMethod, { label: string; help: string; passesMax: number }> = {
  clean: { label: 'Clean surface (keeps edges)', help: 'Irons out the grainy, lumpy surface generated models have, while panel lines, creases and trim stay crisp. Best first choice for Meshy bodies.', passesMax: 40 },
  even: { label: 'Even out (keeps shape)', help: 'Removes ripples and waves without shrinking the body or rounding its overall shape.', passesMax: 120 },
  fill: { label: 'Fill dents', help: 'Pulls the surface flat across wide, deep dents. The strongest, but it rounds off small details inside the selection.', passesMax: 120 },
}

const RELAX = 1.6
const TAUBIN_LAMBDA = 0.5
const TAUBIN_MU = -0.53
const VERTEX_ITERATIONS = 16

function movable(topo: Topology, links: number[][], c: number) {
  return !topo.boundary[c] && !!links[c]?.length
}

/** In-place over-relaxation toward the neighbours; the unselected rim stays fixed, so the patch settles into the surface around it. */
function relax(p: Float32Array, links: number[][], order: number[], passes: number) {
  for (let i = 0; i < passes; i++) {
    for (const c of order) {
      const near = links[c]
      let x = 0, y = 0, z = 0
      for (const n of near) { x += p[n * 3]; y += p[n * 3 + 1]; z += p[n * 3 + 2] }
      p[c * 3] += RELAX * (x / near.length - p[c * 3])
      p[c * 3 + 1] += RELAX * (y / near.length - p[c * 3 + 1])
      p[c * 3 + 2] += RELAX * (z / near.length - p[c * 3 + 2])
    }
  }
}

/** Taubin λ|μ smoothing: a shrink step then an inflate step, so bumps go but the volume stays. */
export function taubin(p: Float32Array, links: number[][], order: number[], passes: number) {
  const d = new Float32Array(order.length * 3)
  for (let i = 0; i < passes; i++) {
    for (const factor of [TAUBIN_LAMBDA, TAUBIN_MU]) {
      for (let k = 0; k < order.length; k++) {
        const c = order[k], near = links[c]
        let x = 0, y = 0, z = 0
        for (const n of near) { x += p[n * 3]; y += p[n * 3 + 1]; z += p[n * 3 + 2] }
        d[k * 3] = x / near.length - p[c * 3]
        d[k * 3 + 1] = y / near.length - p[c * 3 + 1]
        d[k * 3 + 2] = z / near.length - p[c * 3 + 2]
      }
      for (let k = 0; k < order.length; k++) {
        const c = order[k]
        p[c * 3] += factor * d[k * 3]; p[c * 3 + 1] += factor * d[k * 3 + 1]; p[c * 3 + 2] += factor * d[k * 3 + 2]
      }
    }
  }
}

/**
 * Feature-preserving denoising (bilateral normal filtering): face normals are
 * averaged only with neighbours that point the same way, then the vertices are
 * moved to fit the filtered normals. Flat and gently curved panels come out
 * smooth while edges sharper than the crease angle keep their line.
 */
function clean(topo: Topology, p: Float32Array, weight: Float32Array, creaseDeg: number, passes: number) {
  const geo = faceGeometry(topo, p)
  const faceCount = topo.faces.length / 3
  const active: number[] = []
  for (let f = 0; f < faceCount; f++) {
    if (weight[topo.faces[f * 3]] > 0 || weight[topo.faces[f * 3 + 1]] > 0 || weight[topo.faces[f * 3 + 2]] > 0) active.push(f)
  }
  if (!active.length) return
  const stamp = new Int32Array(faceCount).fill(-1)
  const ringStart = new Int32Array(active.length + 1)
  const ring: number[] = []
  let spacing = 0, spacingCount = 0
  active.forEach((f, k) => {
    for (let corner = 0; corner < 3; corner++) {
      const c = topo.faces[f * 3 + corner]
      for (let j = topo.clusterFaceStart[c]; j < topo.clusterFaceStart[c + 1]; j++) {
        const g = topo.clusterFaceList[j]
        if (stamp[g] === k) continue
        stamp[g] = k
        ring.push(g)
        if (g !== f && spacingCount < 200000) {
          spacing += Math.hypot(geo.centroid[f * 3] - geo.centroid[g * 3], geo.centroid[f * 3 + 1] - geo.centroid[g * 3 + 1], geo.centroid[f * 3 + 2] - geo.centroid[g * 3 + 2])
          spacingCount++
        }
      }
    }
    ringStart[k + 1] = ring.length
  })
  const sigmaS = spacingCount ? spacing / spacingCount : 1
  const sigmaR = Math.max(0.2, Math.sin((creaseDeg * Math.PI) / 360))
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180)
  const inv2s = 1 / (2 * sigmaS * sigmaS), inv2r = 1 / (2 * sigmaR * sigmaR)
  let normals = Float32Array.from(geo.unit)
  for (let it = 0; it < passes; it++) {
    const next = Float32Array.from(normals)
    for (let k = 0; k < active.length; k++) {
      const f = active[k]
      const fx = normals[f * 3], fy = normals[f * 3 + 1], fz = normals[f * 3 + 2]
      let x = 0, y = 0, z = 0
      for (let j = ringStart[k]; j < ringStart[k + 1]; j++) {
        const g = ring[j]
        const gx = normals[g * 3], gy = normals[g * 3 + 1], gz = normals[g * 3 + 2]
        const dot = fx * gx + fy * gy + fz * gz
        if (g !== f && dot < cosLimit) continue
        const dx = geo.centroid[f * 3] - geo.centroid[g * 3], dy = geo.centroid[f * 3 + 1] - geo.centroid[g * 3 + 1], dz = geo.centroid[f * 3 + 2] - geo.centroid[g * 3 + 2]
        const nd = (fx - gx) ** 2 + (fy - gy) ** 2 + (fz - gz) ** 2
        const w = geo.area[g] * Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2s - nd * inv2r)
        x += w * gx; y += w * gy; z += w * gz
      }
      const l = Math.hypot(x, y, z)
      if (l > 0) { next[f * 3] = x / l; next[f * 3 + 1] = y / l; next[f * 3 + 2] = z / l }
    }
    normals = next
  }
  const moving: number[] = []
  for (let c = 0; c < weight.length; c++) if (weight[c] > 0 && !topo.boundary[c]) moving.push(c)
  const f3 = topo.faces
  for (let it = 0; it < VERTEX_ITERATIONS; it++) {
    for (const f of active) {
      const a = f3[f * 3] * 3, b = f3[f * 3 + 1] * 3, c = f3[f * 3 + 2] * 3
      geo.centroid[f * 3] = (p[a] + p[b] + p[c]) / 3
      geo.centroid[f * 3 + 1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3
      geo.centroid[f * 3 + 2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3
    }
    for (const c of moving) {
      let x = 0, y = 0, z = 0, count = 0
      for (let j = topo.clusterFaceStart[c]; j < topo.clusterFaceStart[c + 1]; j++) {
        const f = topo.clusterFaceList[j]
        const nx = normals[f * 3], ny = normals[f * 3 + 1], nz = normals[f * 3 + 2]
        const d = nx * (geo.centroid[f * 3] - p[c * 3]) + ny * (geo.centroid[f * 3 + 1] - p[c * 3 + 1]) + nz * (geo.centroid[f * 3 + 2] - p[c * 3 + 2])
        x += nx * d; y += ny * d; z += nz * d; count++
      }
      if (!count) continue
      p[c * 3] += x / count; p[c * 3 + 1] += y / count; p[c * 3 + 2] += z / count
    }
  }
}

/** The selection's smoothed positions at full strength (weights and strength are blended in by the caller). */
export function smoothPositions(topo: Topology, base: Float32Array, weight: Float32Array, method: SmoothMethod, passes: number, creaseDeg: number) {
  const p = Float32Array.from(base)
  const steps = Math.max(1, Math.min(SMOOTH_METHODS[method].passesMax, Math.round(passes)))
  if (method === 'clean') { clean(topo, p, weight, creaseDeg, steps); return p }
  const links = creaseLinks(topo, clusterNormals(topo, base), creaseDeg, c => weight[c] > 0)
  const order: number[] = []
  for (let c = 0; c < weight.length; c++) if (weight[c] > 0 && movable(topo, links, c)) order.push(c)
  if (method === 'fill') relax(p, links, order, steps)
  else taubin(p, links, order, steps)
  return p
}

/**
 * How far each point stands off the surface it would have if the small lumps
 * were ironed out: the body is smoothed hard (keeping creases), and the
 * distance along the normal is the bump or dent depth in local units.
 */
export function bumpDepths(topo: Topology, base: Float32Array, creaseDeg: number) {
  const normals = clusterNormals(topo, base)
  const links = creaseLinks(topo, normals, creaseDeg, () => true)
  const order: number[] = []
  for (let c = 0; c < topo.clusters.length; c++) if (movable(topo, links, c)) order.push(c)
  const q = Float32Array.from(base)
  taubin(q, links, order, 40)
  const depth = new Float32Array(topo.clusters.length)
  for (let c = 0; c < depth.length; c++) {
    depth[c] = Math.abs((base[c * 3] - q[c * 3]) * normals[c * 3] + (base[c * 3 + 1] - q[c * 3 + 1]) * normals[c * 3 + 1] + (base[c * 3 + 2] - q[c * 3 + 2]) * normals[c * 3 + 2])
  }
  const blended = new Float32Array(depth.length)
  for (let c = 0; c < depth.length; c++) {
    const near = topo.neighbours[c]
    let sum = 0
    for (const n of near) sum += depth[n]
    blended[c] = near.length ? 0.5 * depth[c] + 0.5 * (sum / near.length) : depth[c]
  }
  return blended
}

/** Grows (max) or shrinks (min) a weight field by one ring of neighbours, scaled by `falloff` for grown points. */
export function spread(topo: Topology, weight: Float32Array, mode: 'grow' | 'shrink', falloff = 1) {
  const out = Float32Array.from(weight)
  for (let c = 0; c < weight.length; c++) {
    for (const n of topo.neighbours[c]) {
      if (mode === 'grow') out[c] = Math.max(out[c], weight[n] * falloff)
      else out[c] = Math.min(out[c], weight[n])
    }
  }
  return out
}
