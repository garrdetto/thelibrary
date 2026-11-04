import { writeFileSync } from 'node:fs'

const kinds = {
  f32: Float32Array,
  i16n: Int16Array,
  u16: Uint16Array,
  u32: Uint32Array,
  u8: Uint8Array,
  u8n: Uint8Array,
}

export function writeMeshBin(path, meta, streams) {
  const layout = []
  let offset = 0
  for (const [name, { type, components, data }] of Object.entries(streams)) {
    const Kind = kinds[type]
    const array = data instanceof Kind ? data : Kind.from(data)
    offset = Math.ceil(offset / 4) * 4
    layout.push({ name, type, components, offset, length: array.length, array })
    offset += array.byteLength
  }
  const header = JSON.stringify({ ...meta, streams: layout.map(({ array: _array, ...rest }) => rest) })
  const headerBytes = new TextEncoder().encode(header)
  const headerPadded = Math.ceil((headerBytes.length + 8) / 4) * 4
  const out = new Uint8Array(headerPadded + offset)
  const view = new DataView(out.buffer)
  out.set([0x4e, 0x57, 0x41, 0x31], 0)
  view.setUint32(4, headerBytes.length, true)
  out.set(headerBytes, 8)
  for (const item of layout) out.set(new Uint8Array(item.array.buffer, item.array.byteOffset, item.array.byteLength), headerPadded + item.offset)
  writeFileSync(path, out)
  return out.byteLength
}

export function quantizeNormals(normals) {
  const out = new Int16Array(normals.length)
  for (let i = 0; i < normals.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(normals[i] * 32767)))
  return out
}

export function smoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l
  }
  return normals
}
