import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'

export const BOAT_SCALE = 3.85
const WATERLINE = -0.13
export const PAINT = { none: 0, hull: 1, cowl: 2, accent: 3, carpet: 4, plain: 5 }

async function rgba(image, size) {
  const { data } = await sharp(Buffer.from(image)).resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [((h * 60) + 360) % 360, max ? d / max : 0, max / 255]
}

function classifyTexel(p, n, color) {
  const [x, y, z] = p
  if (x > 0.66 && y > -0.03 && Math.abs(z) < 0.1) return PAINT.cowl
  if (x < -0.735 && y > -0.02) return PAINT.plain
  if (x > 0.655 && y > -0.07 && Math.abs(z) > 0.1 && Math.abs(z) < 0.215) return PAINT.plain
  const transom = x > 0.6 && x < 0.672 && n[0] > 0.6 && y < -0.012 && Math.abs(z) < 0.27
  const cx = Math.max(-0.62, Math.min(0.55, x))
  const ox = x - cx, oz = z
  const ol = Math.hypot(ox, oz) || 1
  const outward = (n[0] * ox + n[2] * oz) / ol
  const side = x < 0.655 && y < -0.008 && outward > 0.3 && Math.abs(n[1]) < 0.85
  const bottom = x < 0.655 && n[1] < -0.3 && y < -0.02
  if (transom || side || bottom) return PAINT.hull
  const [h, s, v] = hsv(color[0], color[1], color[2])
  if ((h < 18 || h > 340) && s > 0.42 && v > 0.2) return PAINT.accent
  if (n[1] > 0.82 && y > -0.03 && y < 0.03 && x < 0.62 && s < 0.18 && v > 0.12 && v < 0.62) return PAINT.carpet
  return PAINT.none
}

function dilate(size, cls, channels, passes) {
  let filled = new Uint8Array(size * size)
  for (let i = 0; i < filled.length; i++) filled[i] = cls[i] !== 255 ? 1 : 0
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice()
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (filled[i]) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const j = ny * size + nx
        if (!filled[j]) continue
        cls[i] = cls[j]
        for (const ch of channels) for (let k = 0; k < ch.stride; k++) ch.data[i * ch.stride + k] = ch.data[j * ch.stride + k]
        next[i] = 1
        break
      }
    }
    filled = next
  }
  for (let i = 0; i < cls.length; i++) if (cls[i] === 255) cls[i] = 0
}

export async function buildBoat(sourcePath, size = 2048) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(sourcePath)
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const pos = prim.getAttribute('POSITION').getArray()
  const uv = prim.getAttribute('TEXCOORD_0').getArray()
  const idx = prim.getIndices().getArray()
  const material = prim.getMaterial()
  const albedo = await rgba(material.getBaseColorTexture().getImage(), size)
  const mr = await rgba(material.getMetallicRoughnessTexture().getImage(), size / 2)

  const cls = new Uint8Array(size * size).fill(255)
  const params = new Uint8Array(size * size * 2)
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2]
    const A = [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]], B = [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]], C = [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]]
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const nl = Math.hypot(...n) || 1
    n = n.map(v => v / nl)
    const ua = [uv[ia * 2] * size, uv[ia * 2 + 1] * size], ub = [uv[ib * 2] * size, uv[ib * 2 + 1] * size], uc = [uv[ic * 2] * size, uv[ic * 2 + 1] * size]
    const minX = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0])))
    const minY = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1])))
    const den = (ub[1] - uc[1]) * (ua[0] - uc[0]) + (uc[0] - ub[0]) * (ua[1] - uc[1])
    if (Math.abs(den) < 1e-9) continue
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const sx = px + 0.5, sy = py + 0.5
      const w1 = ((ub[1] - uc[1]) * (sx - uc[0]) + (uc[0] - ub[0]) * (sy - uc[1])) / den
      const w2 = ((uc[1] - ua[1]) * (sx - uc[0]) + (ua[0] - uc[0]) * (sy - uc[1])) / den
      const w3 = 1 - w1 - w2
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue
      const p = [A[0] * w1 + B[0] * w2 + C[0] * w3, A[1] * w1 + B[1] * w2 + C[1] * w3, A[2] * w1 + B[2] * w2 + C[2] * w3]
      const i = py * size + px
      const c = [albedo[i * 4], albedo[i * 4 + 1], albedo[i * 4 + 2]]
      cls[i] = classifyTexel(p, n, c)
      params[i * 2] = Math.round(Math.max(0, Math.min(1, (p[0] + 0.96) / 1.64)) * 255)
      params[i * 2 + 1] = Math.round(Math.max(0, Math.min(1, (p[1] + 0.22) / 0.22)) * 255)
    }
  }
  dilate(size, cls, [{ data: params, stride: 2 }], 6)

  const paint = new Uint8Array(size * size * 4)
  const base = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const c = cls[i]
    const lum = Math.round(0.2126 * albedo[i * 4] + 0.7152 * albedo[i * 4 + 1] + 0.0722 * albedo[i * 4 + 2])
    paint[i * 4] = c * 40
    paint[i * 4 + 1] = params[i * 2]
    paint[i * 4 + 2] = c === PAINT.accent || c === PAINT.carpet ? lum : params[i * 2 + 1]
    paint[i * 4 + 3] = 255
    const neutral = c === PAINT.hull || c === PAINT.cowl || c === PAINT.plain
    base[i * 4] = neutral ? 180 : albedo[i * 4]
    base[i * 4 + 1] = neutral ? 180 : albedo[i * 4 + 1]
    base[i * 4 + 2] = neutral ? 180 : albedo[i * 4 + 2]
    base[i * 4 + 3] = 255
  }
  const half = size / 2
  const rough = new Uint8Array(half * half * 4)
  for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    const i = y * half + x
    const c = cls[(y * 2) * size + x * 2]
    rough[i * 4] = 255
    rough[i * 4 + 1] = c === PAINT.hull || c === PAINT.cowl ? 60 : Math.max(90, mr[i * 4 + 1])
    rough[i * 4 + 2] = c === PAINT.hull || c === PAINT.cowl ? 0 : mr[i * 4 + 2]
    rough[i * 4 + 3] = 255
  }

  const count = pos.length / 3
  const positions = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]
    positions[v * 3] = -z * BOAT_SCALE
    positions[v * 3 + 1] = (y - WATERLINE) * BOAT_SCALE
    positions[v * 3 + 2] = x * BOAT_SCALE
  }
  return {
    positions,
    uvs: Float32Array.from(uv),
    indices: count < 65535 ? Uint16Array.from(idx) : Uint32Array.from(idx),
    textures: {
      base: await sharp(Buffer.from(base), { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 88 }).toBuffer(),
      paint: await sharp(Buffer.from(paint), { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer(),
      rough: await sharp(Buffer.from(rough), { raw: { width: half, height: half, channels: 4 } }).webp({ quality: 85 }).toBuffer(),
    },
  }
}

export function toBoatSpace(x, y, z) {
  return [-z * BOAT_SCALE, (y - WATERLINE) * BOAT_SCALE, x * BOAT_SCALE]
}
