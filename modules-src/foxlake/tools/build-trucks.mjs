/**
 * Turns the Meshy truck scans (assets-src/models/foxlake/trucks.meshy.json) into the fleet's bodies, without Blender:
 *
 *   node modules-src/foxlake/tools/build-trucks.mjs <cacheDir>
 *
 * <cacheDir> holds <kind>-raw.glb as downloaded. Each scan is welded and simplified (meshopt) to about 250k triangles,
 * turned to face +x, scaled so its tires are 1.06 m across, centred along its length and set down so the tires sit on
 * the road under the chassis frame of shared/FleetVehicles.ts (the wheel centres measured here are printed, and are
 * the axle positions in that file). The scanned wheels are cut out (the game draws its own spinning, steering duals),
 * and on the dump truck everything above the frame behind the cab, plus the cab protector over the roof, becomes its
 * own mesh, `dumpbed`, which the game tips about its rear hinge. Textures stay 2048 px (WebP via `pnpm assets`). Output: assets-src/models/maplestreet/vehicles/<kind>.glb.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { join, resolve } from 'node:path'

const cache = resolve(process.argv[2] ?? '.meshy-cache/trucks')
const OUT = resolve('assets-src/models/maplestreet/vehicles')
const TIRE_RADIUS = 0.53

/**
 * Measured on the scans (model units, before turning): wheel centres along x, the wheel centre height, the tire
 * radius and each axle's inner and outer tire faces across z. `ride` is the chassis centre's height above the road
 * in shared/FleetVehicles.ts.
 */
const SPECS = {
  dumptruck: {
    wheels: [{ x: -0.734, inner: 0.19, outer: 0.29 }, { x: 0.357, inner: 0.115, outer: 0.29 }, { x: 0.685, inner: 0.115, outer: 0.29 }],
    wheelY: -0.27, radius: 0.128, ride: 1.85,
    bed: { minX: -0.255, minY: -0.165, protectorX: -0.315, protectorY: 0.262 },
  },
  semi: {
    wheels: [{ x: -0.78, inner: 0.17, outer: 0.33 }, { x: 0.459, inner: 0.115, outer: 0.29 }, { x: 0.77, inner: 0.115, outer: 0.29 }],
    wheelY: -0.316, radius: 0.125, ride: 1.8,
  },
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
await MeshoptSimplifier.ready

for (const [kind, spec] of Object.entries(SPECS)) {
  const doc = await io.read(join(cache, `${kind}-raw.glb`))
  const tris = () => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((n, p) => n + p.getIndices().getCount() / 3, 0)
  await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, 250000 / tris()), error: 0.0008 }), prune())
  const root = doc.getRoot()
  const scene = root.listScenes()[0]
  const [mesh] = root.listMeshes()
  const prim = mesh.listPrimitives()[0]
  const pos = prim.getAttribute('POSITION')
  const n = pos.getCount()
  const P = pos.getArray()
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); y0 = Math.min(y0, P[i * 3 + 1]) }
  const scale = TIRE_RADIUS / spec.radius
  const cx = (x0 + x1) / 2
  const ground = spec.wheelY - spec.radius
  const toChassis = (x, y, z) => [-(x - cx) * scale, (y - ground) * scale - spec.ride, -z * scale]
  const idx = prim.getIndices().getArray()
  const keep = [], bed = []
  let cut = 0
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2]
    const mx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, my = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, mz = Math.abs((P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3)
    if (spec.wheels.some(w => Math.hypot(mx - w.x, my - spec.wheelY) < spec.radius * 1.03 && mz > w.inner && mz < w.outer + 0.02)) { cut++; continue }
    if (spec.bed && ((mx > spec.bed.minX && my > spec.bed.minY) || (mx > spec.bed.protectorX && my > spec.bed.protectorY))) {
      bed.push(a, b, c)
      continue
    }
    keep.push(a, b, c)
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) out.set(toChassis(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), i * 3)
  pos.setArray(out)
  const nrm = prim.getAttribute('NORMAL')
  if (nrm) {
    const N = nrm.getArray()
    for (let i = 0; i < n; i++) { N[i * 3] = -N[i * 3]; N[i * 3 + 2] = -N[i * 3 + 2] }
    nrm.setArray(N)
  }
  const indices = (list) => doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(root.listBuffers()[0])
  prim.setIndices(indices(keep))
  mesh.setName(`${kind}-body`)
  for (const node of root.listNodes()) { node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); node.setName(`${kind}-body`) }
  if (bed.length) {
    const bedPrim = prim.clone().setIndices(indices(bed))
    const bedMesh = doc.createMesh('dumpbed').addPrimitive(bedPrim)
    scene.addChild(doc.createNode('dumpbed').setMesh(bedMesh))
  }
  await doc.transform(prune())
  const axles = spec.wheels.map(w => Math.round(-(w.x - cx) * scale * 100) / 100)
  const tracks = spec.wheels.map(w => Math.round(((w.inner + w.outer) / 2) * scale * 100) / 100)
  console.log(kind, { scale: Math.round(scale * 1000) / 1000, length: Math.round((x1 - x0) * scale * 100) / 100, axles, halfTracks: tracks, cutTriangles: cut, bedTriangles: bed.length / 3, kept: keep.length / 3 })
  await io.write(join(OUT, `${kind}.glb`), doc)
}
