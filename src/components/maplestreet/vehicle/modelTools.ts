import { Document, WebIO } from '@gltf-transform/core'
import type { Material, Primitive, Texture, TextureInfo } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { browserCodec } from './textureEncode'
import type { TextureCodec, TextureKind } from './textureEncode'

export type ShrinkOptions = {
  /** Triangles to aim for; models already under it are left alone. */
  targetTriangles: number
  /** Longest texture side in pixels (of the base model, when an HD pack is made). */
  maxTexture: number
  /**
   * Longest texture side of the HD pack. When it is larger than `maxTexture`,
   * every texture that is bigger than the base model allows also goes, at up
   * to this size, into a separate texture pack. Implies `webp`.
   */
  hdTexture?: number
  /** Compress textures as WebP at a quality that suits each map. Without it they are re-encoded as before (JPEG, or PNG with alpha). */
  webp?: boolean
  /** Remove triangles inside these cylinders (chassis-frame wheels). */
  cutWheels?: { transform: ModelTransform; wheels: WheelCylinder[] } | null
}

export type ModelTransform = { scale: number; yaw: number; x: number; y: number; z: number }
export type WheelCylinder = { x: number; y: number; z: number; radius: number; width: number }

export type ShrinkReport = {
  bytesBefore: number
  bytesAfter: number
  trianglesBefore: number
  trianglesAfter: number
  texturesResized: number
  wheelTrianglesRemoved: number
  /** Size of the HD pack, 0 when none was made. */
  hdBytes: number
  /** Longest texture side in the model and in the HD pack (0 without textures or a pack). */
  textureSide: number
  hdTextureSide: number
}

let ioPromise: Promise<WebIO> | null = null
function io() {
  ioPromise ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]).then(() => new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder }))
  return ioPromise
}

function triangleCount(doc: Document) {
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue
    const idx = prim.getIndices()
    total += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0) / 3)
  }
  return total
}

type Mat4 = number[]
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}
function chassisMatrix(t: ModelTransform): Mat4 {
  const a = (t.yaw * Math.PI) / 180, c = Math.cos(a) * t.scale, s = Math.sin(a) * t.scale
  return [c, 0, -s, 0, 0, t.scale, 0, 0, s, 0, c, 0, t.x, t.y, t.z, 1]
}

/** Deletes triangles whose centers sit inside a wheel cylinder (axle along chassis Z). */
function cutWheels(doc: Document, transform: ModelTransform, wheels: WheelCylinder[]) {
  const base = chassisMatrix(transform)
  let removed = 0
  const handled = new Set<Primitive>()
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = multiply(base, node.getWorldMatrix() as unknown as number[])
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || handled.has(prim)) continue
      handled.add(prim)
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const indices = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.getCount() }, (_, i) => i)
      const keep: number[] = []
      const v = [0, 0, 0]
      const world = (i: number) => {
        pos.getElement(i, v)
        return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]
      }
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = world(indices[t]), b = world(indices[t + 1]), c = world(indices[t + 2])
        const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3
        const inside = wheels.some(w => Math.abs(cz - w.z) < w.width * 0.75 && Math.hypot(cx - w.x, cy - w.y) < w.radius * 1.06)
        if (inside) removed++
        else keep.push(indices[t], indices[t + 1], indices[t + 2])
      }
      const big = pos.getCount() > 65535
      const accessor = doc.createAccessor().setType('SCALAR').setArray(big ? Uint32Array.from(keep) : Uint16Array.from(keep))
      const buffer = doc.getRoot().listBuffers()[0]
      if (buffer) accessor.setBuffer(buffer)
      prim.setIndices(accessor)
    }
  }
  return removed
}

async function resizeTexture(texture: Texture, maxSide: number): Promise<boolean> {
  const image = texture.getImage()
  const mime = texture.getMimeType()
  if (!image || !/image\/(png|jpeg|webp)/.test(mime)) return false
  const bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mime }))
  const longest = Math.max(bitmap.width, bitmap.height)
  const fits = longest <= maxSide
  const scale = fits ? 1 : maxSide / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let alpha = false
  for (let i = 3; i < pixels.length; i += 16) if (pixels[i] < 250) { alpha = true; break }
  const outType = alpha ? 'image/png' : 'image/jpeg'
  if (fits && outType === mime) return false
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outType, 0.86))
  if (!blob || (fits && blob.size >= image.byteLength)) return false
  texture.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType(outType)
  return true
}

const IMAGE_TYPES = /image\/(png|jpeg|webp)/
const LOSSY_TYPES = /image\/(jpeg|webp)/
const GLASS_NAME = /glass|window|windshield/i

type Slot = { texture: (m: Material) => Texture | null; info: (m: Material) => TextureInfo | null; set: (m: Material, t: Texture) => void; kind: TextureKind }
const SLOTS: Slot[] = [
  { texture: m => m.getBaseColorTexture(), info: m => m.getBaseColorTextureInfo(), set: (m, t) => { m.setBaseColorTexture(t) }, kind: 'color' },
  { texture: m => m.getEmissiveTexture(), info: m => m.getEmissiveTextureInfo(), set: (m, t) => { m.setEmissiveTexture(t) }, kind: 'color' },
  { texture: m => m.getNormalTexture(), info: m => m.getNormalTextureInfo(), set: (m, t) => { m.setNormalTexture(t) }, kind: 'normal' },
  { texture: m => m.getMetallicRoughnessTexture(), info: m => m.getMetallicRoughnessTextureInfo(), set: (m, t) => { m.setMetallicRoughnessTexture(t) }, kind: 'data' },
  { texture: m => m.getOcclusionTexture(), info: m => m.getOcclusionTextureInfo(), set: (m, t) => { m.setOcclusionTexture(t) }, kind: 'data' },
]

const textured = (material: Material) => SLOTS.some(slot => slot.texture(material))

/** What each texture is used for; one shared between colour and data slots is treated as data so it is compressed gently. */
function textureKinds(doc: Document) {
  const kinds = new Map<Texture, TextureKind>()
  for (const material of doc.getRoot().listMaterials()) for (const slot of SLOTS) {
    const texture = slot.texture(material)
    if (!texture) continue
    const known = kinds.get(texture)
    kinds.set(texture, known && known !== slot.kind ? 'data' : slot.kind)
  }
  return kinds
}

/** The HD pack is matched to the model by material name, so every textured material gets a name of its own. */
function nameMaterials(doc: Document) {
  const taken = new Set<string>()
  doc.getRoot().listMaterials().forEach((material, i) => {
    if (!textured(material)) { taken.add(material.getName()); return }
    const wanted = material.getName().trim() || `material_${i + 1}`
    let name = wanted
    for (let n = 2; taken.has(name); n++) name = `${wanted}_${n}`
    taken.add(name)
    if (name !== material.getName()) material.setName(name)
  })
}

function longestSide(texture: Texture) {
  const size = texture.getSize()
  return size ? Math.max(size[0], size[1]) : Infinity
}

function useWebp(doc: Document) {
  if (doc.getRoot().listTextures().some(texture => texture.getMimeType() === 'image/webp')) doc.createExtension(EXTTextureWebP).setRequired(true)
}

/**
 * One image fitted inside `maxSide`, or null when it is best left exactly as
 * it is: a JPEG or WebP that already fits is never compressed a second time.
 */
async function fitImage(image: Uint8Array, mimeType: string, longest: number, kind: TextureKind, maxSide: number, codec: TextureCodec) {
  const fits = longest <= maxSide
  if (fits && LOSSY_TYPES.test(mimeType)) return null
  const out = await codec(image, mimeType, kind, maxSide)
  if (!out || (fits && out.bytes.byteLength >= image.byteLength)) return null
  return out
}

type Image = { bytes: Uint8Array; mimeType: string }

/**
 * The HD pack: for each textured material of the model, a material with the
 * same name and the same texture slots at full size, on one small triangle.
 */
async function writeHdPack(doc: Document, full: Map<Texture, Image>): Promise<Uint8Array> {
  const pack = new Document()
  const buffer = pack.createBuffer()
  const scene = pack.createScene('hd')
  const made = new Map<Texture, Texture>()
  const copy = (texture: Texture) => {
    let twin = made.get(texture)
    if (!twin) {
      const image = full.get(texture)
      twin = pack.createTexture(texture.getName()).setImage(image?.bytes ?? texture.getImage()!).setMimeType(image?.mimeType ?? texture.getMimeType())
      made.set(texture, twin)
    }
    return twin
  }
  let count = 0
  for (const material of doc.getRoot().listMaterials()) {
    if (!textured(material)) continue
    const twin = pack.createMaterial(material.getName())
    let secondUv = false
    for (const slot of SLOTS) {
      const texture = slot.texture(material)
      if (!texture?.getImage()) continue
      slot.set(twin, copy(texture))
      const from = slot.info(material), to = slot.info(twin)
      if (from && to) {
        to.setTexCoord(from.getTexCoord()).setWrapS(from.getWrapS()).setWrapT(from.getWrapT()).setMagFilter(from.getMagFilter()).setMinFilter(from.getMinFilter())
        if (from.getTexCoord() > 0) secondUv = true
      }
    }
    twin.setNormalScale(material.getNormalScale()).setOcclusionStrength(material.getOcclusionStrength())
    const x = count++ * 0.01
    const accessor = (type: 'VEC2' | 'VEC3', values: number[]) => pack.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer)
    const uv = accessor('VEC2', [0, 0, 1, 0, 0, 1])
    const primitive = pack.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', [x, 0, 0, x + 0.004, 0, 0, x, 0.004, 0]))
      .setAttribute('NORMAL', accessor('VEC3', [0, 0, 1, 0, 0, 1, 0, 0, 1]))
      .setAttribute('TEXCOORD_0', uv)
      .setMaterial(twin)
    if (secondUv) primitive.setAttribute('TEXCOORD_1', uv)
    scene.addChild(pack.createNode(material.getName()).setMesh(pack.createMesh(material.getName()).addPrimitive(primitive)))
  }
  useWebp(pack)
  return (await io()).writeBinary(pack)
}

/**
 * Polygon reduction, texture fitting and meshopt compression (plus optional
 * baked-wheel removal). With `hdTexture` the model keeps small textures for a
 * fast first load and the full-size ones come back as a separate HD pack.
 */
export async function shrinkModel(bytes: Uint8Array, options: ShrinkOptions, codec: TextureCodec = browserCodec): Promise<{ bytes: Uint8Array; hd: Uint8Array | null; report: ShrinkReport }> {
  const reader = await io()
  const doc = await reader.readBinary(bytes)
  const trianglesBefore = triangleCount(doc)
  const wheelTrianglesRemoved = options.cutWheels?.wheels.length ? cutWheels(doc, options.cutWheels.transform, options.cutWheels.wheels) : 0
  await doc.transform(dedup(), weld())
  const current = triangleCount(doc)
  if (current > options.targetTriangles) {
    await MeshoptSimplifier.ready
    const lockBorder = doc.getRoot().listMaterials().some(material => GLASS_NAME.test(material.getName()))
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, options.targetTriangles / current), error: 0.01, lockBorder }))
  }
  const hdSide = options.hdTexture ?? 0
  let texturesResized = 0, hd: Uint8Array | null = null, hdTextureSide = 0
  if (options.webp || hdSide > 0) {
    nameMaterials(doc)
    const kinds = textureKinds(doc)
    const full = new Map<Texture, Image>()
    for (const texture of doc.getRoot().listTextures()) {
      const image = texture.getImage(), mimeType = texture.getMimeType()
      if (!image || !IMAGE_TYPES.test(mimeType) || !kinds.has(texture)) continue
      const kind = kinds.get(texture)!
      const longest = longestSide(texture)
      if (hdSide > options.maxTexture && longest > options.maxTexture) {
        const fitted = await fitImage(image, mimeType, longest, kind, hdSide, codec)
        full.set(texture, fitted ?? { bytes: image, mimeType })
        hdTextureSide = Math.max(hdTextureSide, Math.min(longest, hdSide))
      }
      const fitted = await fitImage(image, mimeType, longest, kind, options.maxTexture, codec)
      if (fitted) { texture.setImage(fitted.bytes).setMimeType(fitted.mimeType); texturesResized++ }
    }
    if (full.size) hd = await writeHdPack(doc, full)
    useWebp(doc)
  } else {
    for (const texture of doc.getRoot().listTextures()) if (await resizeTexture(texture, options.maxTexture)) texturesResized++
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = await reader.writeBinary(doc)
  const textureSide = doc.getRoot().listTextures().reduce((side, texture) => { const longest = longestSide(texture); return Number.isFinite(longest) ? Math.max(side, longest) : side }, 0)
  return { bytes: out, hd, report: { bytesBefore: bytes.byteLength, bytesAfter: out.byteLength, trianglesBefore, trianglesAfter: triangleCount(doc), texturesResized, wheelTrianglesRemoved, hdBytes: hd?.byteLength ?? 0, textureSide, hdTextureSide } }
}

/**
 * Puts an HD pack's textures back on a model (matched by material name), so a
 * published vehicle reopens in the editor at full texture size.
 */
export async function mergeHdPack(model: Uint8Array, hdPack: Uint8Array): Promise<Uint8Array> {
  const reader = await io()
  const doc = await reader.readBinary(model)
  const pack = await reader.readBinary(hdPack)
  const byName = new Map(pack.getRoot().listMaterials().map(material => [material.getName(), material]))
  const made = new Map<Texture, Texture>()
  const copy = (texture: Texture) => {
    let twin = made.get(texture)
    if (!twin) { twin = doc.createTexture(texture.getName()).setImage(texture.getImage()!).setMimeType(texture.getMimeType()); made.set(texture, twin) }
    return twin
  }
  for (const material of doc.getRoot().listMaterials()) {
    const from = byName.get(material.getName())
    if (!from) continue
    for (const slot of SLOTS) {
      const texture = slot.texture(from)
      if (texture?.getImage() && slot.texture(material)) slot.set(material, copy(texture))
    }
  }
  useWebp(doc)
  await doc.transform(prune())
  return reader.writeBinary(doc)
}

export async function modelStats(bytes: Uint8Array) {
  const doc = await (await io()).readBinary(bytes)
  return { triangles: triangleCount(doc), textures: doc.getRoot().listTextures().length, materials: doc.getRoot().listMaterials().map(m => m.getName()) }
}

/** Reads a .gltf (self-contained) or .glb into .glb bytes so every later step works on one format. */
export async function toGlb(file: File): Promise<Uint8Array> {
  const reader = await io()
  const raw = new Uint8Array(await file.arrayBuffer())
  if (/\.glb$/i.test(file.name)) return raw
  const json = JSON.parse(new TextDecoder().decode(raw))
  const doc = await reader.readJSON({ json, resources: {} })
  return reader.writeBinary(doc)
}
