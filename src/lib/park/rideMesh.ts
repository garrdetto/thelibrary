/**
 * Baked Thrill Park ride mesh (".tpr"): the admin Ride Creator bakes a Meshy or
 * uploaded model into this compact triangle list, and the park renderer reads it
 * without any glTF code. Coordinates are park space: metres, Z up, origin at the
 * footprint centre on the ground. Colours are sRGB 0–1 like `hexColor`.
 *
 * Layout (little-endian): u32 magic 'TPR1', u32 triangles, f32 metres per unit,
 * f32 height, then 14 bytes per corner: i16×3 position, i8×3 normal, u8 part
 * (0 = base, 1 = main moving part, 2 + n = extra moving piece n), u8×3 colour, u8 pad.
 * 'TPR2' adds the extra pieces after the corners: u16 count, u16 pad, then 24 bytes
 * each: u8 group, u8 carrier part, u8 index in group, u8 pad, f32×3 pivot,
 * f32 azimuth around the main pivot, f32 reach.
 */

export const RIDE_MESH_MAGIC = 0x31525054
export const RIDE_MESH_MAGIC_PIECES = 0x32525054
const HEADER = 16
const CORNER = 14
const INSTANCE = 24

/** One baked copy of an extra moving piece (a cage, a car, a seat). Its part id is its index + 2. */
export type RideInstance = {
  group: number
  /** Part that carries it: 0 base, 1 main moving part, 2 + n another piece. */
  carrier: number
  index: number
  pivot: [number, number, number]
  azimuth: number
  reach: number
}

export type RideMesh = {
  triangles: number
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  parts: Uint8Array
  height: number
  instances: RideInstance[]
}

export function encodeRideMesh(mesh: RideMesh): Uint8Array<ArrayBuffer> {
  const corners = mesh.triangles * 3
  let extent = 0.001
  for (let i = 0; i < corners * 3; i++) extent = Math.max(extent, Math.abs(mesh.positions[i]))
  const quant = extent / 32767
  const instances = mesh.instances ?? []
  const body = HEADER + corners * CORNER
  const out = new Uint8Array(body + (instances.length ? 4 + instances.length * INSTANCE : 0))
  const view = new DataView(out.buffer)
  view.setUint32(0, instances.length ? RIDE_MESH_MAGIC_PIECES : RIDE_MESH_MAGIC, true)
  view.setUint32(4, mesh.triangles, true)
  view.setFloat32(8, quant, true)
  view.setFloat32(12, mesh.height, true)
  for (let c = 0; c < corners; c++) {
    const o = HEADER + c * CORNER
    for (let k = 0; k < 3; k++) {
      view.setInt16(o + k * 2, Math.round(mesh.positions[c * 3 + k] / quant), true)
      view.setInt8(o + 6 + k, Math.max(-127, Math.min(127, Math.round(mesh.normals[c * 3 + k] * 127))))
      out[o + 10 + k] = Math.max(0, Math.min(255, Math.round(mesh.colors[c * 3 + k] * 255)))
    }
    out[o + 9] = Math.min(255, mesh.parts[c])
  }
  if (instances.length) {
    view.setUint16(body, instances.length, true)
    instances.forEach((instance, i) => {
      const o = body + 4 + i * INSTANCE
      out[o] = instance.group; out[o + 1] = instance.carrier; out[o + 2] = instance.index
      view.setFloat32(o + 4, instance.pivot[0], true); view.setFloat32(o + 8, instance.pivot[1], true); view.setFloat32(o + 12, instance.pivot[2], true)
      view.setFloat32(o + 16, instance.azimuth, true); view.setFloat32(o + 20, instance.reach, true)
    })
  }
  return out
}

export function decodeRideMesh(buffer: ArrayBuffer): RideMesh {
  if (buffer.byteLength < HEADER) throw new Error('Ride mesh is empty.')
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  if (magic !== RIDE_MESH_MAGIC && magic !== RIDE_MESH_MAGIC_PIECES) throw new Error('Not a ride mesh.')
  const triangles = view.getUint32(4, true), quant = view.getFloat32(8, true), height = view.getFloat32(12, true)
  const corners = triangles * 3
  if (HEADER + corners * CORNER > buffer.byteLength) throw new Error('Ride mesh is truncated.')
  const bytes = new Uint8Array(buffer)
  const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3), colors = new Float32Array(corners * 3), parts = new Uint8Array(corners)
  for (let c = 0; c < corners; c++) {
    const o = HEADER + c * CORNER
    for (let k = 0; k < 3; k++) {
      positions[c * 3 + k] = view.getInt16(o + k * 2, true) * quant
      normals[c * 3 + k] = view.getInt8(o + 6 + k) / 127
      colors[c * 3 + k] = bytes[o + 10 + k] / 255
    }
    parts[c] = bytes[o + 9]
  }
  const instances: RideInstance[] = []
  const body = HEADER + corners * CORNER
  if (magic === RIDE_MESH_MAGIC_PIECES && body + 4 <= buffer.byteLength) {
    const count = view.getUint16(body, true)
    if (body + 4 + count * INSTANCE > buffer.byteLength) throw new Error('Ride mesh is truncated.')
    for (let i = 0; i < count; i++) {
      const o = body + 4 + i * INSTANCE
      instances.push({ group: bytes[o], carrier: bytes[o + 1], index: bytes[o + 2], pivot: [view.getFloat32(o + 4, true), view.getFloat32(o + 8, true), view.getFloat32(o + 12, true)], azimuth: view.getFloat32(o + 16, true), reach: view.getFloat32(o + 20, true) })
    }
  }
  for (let c = 0; c < corners; c++) if (parts[c] > 1 + instances.length) parts[c] = 1
  return { triangles, positions, normals, colors, parts, height, instances }
}

/** Triangles in each part, for the editor's read-out. */
export function partCounts(mesh: RideMesh) {
  let moving = 0, pieces = 0
  for (let t = 0; t < mesh.triangles; t++) { const part = mesh.parts[t * 3]; if (part === 1) moving++; else if (part > 1) pieces++ }
  return { base: mesh.triangles - moving - pieces, moving, pieces }
}

/** Baked bytes for the editor's size read-out. */
export const encodedSize = (mesh: RideMesh) => HEADER + mesh.triangles * 3 * CORNER + (mesh.instances.length ? 4 + mesh.instances.length * INSTANCE : 0)
