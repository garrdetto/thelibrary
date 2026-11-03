import { Document, WebIO } from '@gltf-transform/core'
import type { Primitive, Texture } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

export type ShrinkOptions = {
  /** Triangles to aim for; models already under it are left alone. */
  targetTriangles: number
  /** Longest texture side in pixels. */
  maxTexture: number
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

/** Polygon reduction, texture resizing and meshopt compression (plus optional baked-wheel removal). */
export async function shrinkModel(bytes: Uint8Array, options: ShrinkOptions): Promise<{ bytes: Uint8Array; report: ShrinkReport }> {
  const reader = await io()
  const doc = await reader.readBinary(bytes)
  const trianglesBefore = triangleCount(doc)
  const wheelTrianglesRemoved = options.cutWheels?.wheels.length ? cutWheels(doc, options.cutWheels.transform, options.cutWheels.wheels) : 0
  await doc.transform(dedup(), weld())
  const current = triangleCount(doc)
  if (current > options.targetTriangles) {
    await MeshoptSimplifier.ready
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, options.targetTriangles / current), error: 0.01 }))
  }
  let texturesResized = 0
  for (const texture of doc.getRoot().listTextures()) if (await resizeTexture(texture, options.maxTexture)) texturesResized++
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = await reader.writeBinary(doc)
  return { bytes: out, report: { bytesBefore: bytes.byteLength, bytesAfter: out.byteLength, trianglesBefore, trianglesAfter: triangleCount(doc), texturesResized, wheelTrianglesRemoved } }
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
