/**
 * Baked Thrill Park ride mesh (".tpr"): the admin Ride Creator bakes a Meshy or
 * uploaded model into this compact triangle list, and the park renderer reads it
 * without any glTF code. Coordinates are park space: metres, Z up, origin at the
 * footprint centre on the ground. Colours are sRGB 0–1 like `hexColor`.
 *
 * Layout (little-endian): u32 magic 'TPR1', u32 triangles, f32 metres per unit,
 * f32 height, then 14 bytes per corner: i16×3 position, i8×3 normal, u8 part
 * (0 = base, 1 = moving), u8×3 colour, u8 pad.
 */

export const RIDE_MESH_MAGIC = 0x31525054
const HEADER = 16
const CORNER = 14

export type RideMesh = {
  triangles: number
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  parts: Uint8Array
  height: number
}

export function encodeRideMesh(mesh: RideMesh): Uint8Array<ArrayBuffer> {
  const corners = mesh.triangles * 3
  let extent = 0.001
  for (let i = 0; i < corners * 3; i++) extent = Math.max(extent, Math.abs(mesh.positions[i]))
  const quant = extent / 32767
  const out = new Uint8Array(HEADER + corners * CORNER)
  const view = new DataView(out.buffer)
  view.setUint32(0, RIDE_MESH_MAGIC, true)
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
    out[o + 9] = mesh.parts[c] ? 1 : 0
  }
  return out
}

export function decodeRideMesh(buffer: ArrayBuffer): RideMesh {
  if (buffer.byteLength < HEADER) throw new Error('Ride mesh is empty.')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== RIDE_MESH_MAGIC) throw new Error('Not a ride mesh.')
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
  return { triangles, positions, normals, colors, parts, height }
}

/** Triangles in each part, for the editor's read-out. */
export function partCounts(mesh: RideMesh) {
  let moving = 0
  for (let t = 0; t < mesh.triangles; t++) if (mesh.parts[t * 3]) moving++
  return { base: mesh.triangles - moving, moving }
}
