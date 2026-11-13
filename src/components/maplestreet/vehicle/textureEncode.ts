/**
 * The one place vehicle textures are compressed for the games. Today that is
 * WebP from the browser's own encoder (PNG where the image needs exact alpha);
 * a GPU-compressed (KTX2) HD pack only has to replace `encodeTexture`.
 */

/** `color`: base colour and emissive. `normal`: normal maps. `data`: metallic-roughness and occlusion. */
export type TextureKind = 'color' | 'normal' | 'data'
export type EncodedTexture = { bytes: Uint8Array; mimeType: string; width: number; height: number }
export type TextureSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement

/** Normal and data maps get a higher quality: block artefacts in them show up as dents and blotchy shine. */
export const TEXTURE_QUALITY: Record<TextureKind, number> = { color: 0.92, normal: 0.96, data: 0.96 }

/** Decodes, fits and re-encodes one stored image. Injected so the pipeline can be run outside a browser. */
export type TextureCodec = (image: Uint8Array, mimeType: string, kind: TextureKind, maxSide: number) => Promise<EncodedTexture | null>

function sizeOf(source: TextureSource) {
  const image = source as HTMLImageElement
  return { width: image.naturalWidth || source.width, height: image.naturalHeight || source.height }
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser could not prepare the textures.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return { canvas, ctx }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))

/**
 * Fits an image inside `maxSide` (never enlarging it) and compresses it for its
 * kind. Large reductions are done in halving steps so fine detail is averaged
 * rather than skipped.
 */
export async function encodeTexture(source: TextureSource, kind: TextureKind, maxSide: number): Promise<EncodedTexture> {
  const from = sizeOf(source)
  const scale = Math.min(1, maxSide / Math.max(1, from.width, from.height))
  const width = Math.max(1, Math.round(from.width * scale)), height = Math.max(1, Math.round(from.height * scale))
  let current: CanvasImageSource = source
  let w = from.width, h = from.height
  while (w / 2 >= width && h / 2 >= height && (w / 2 > width || h / 2 > height)) {
    w = Math.max(width, Math.round(w / 2))
    h = Math.max(height, Math.round(h / 2))
    current = draw(current, w, h).canvas
  }
  const { canvas, ctx } = draw(current, width, height)
  const pixels = ctx.getImageData(0, 0, width, height).data
  let alpha = false
  for (let i = 3; i < pixels.length; i += 16) if (pixels[i] < 250) { alpha = true; break }
  let blob = alpha ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/webp', TEXTURE_QUALITY[kind])
  if (blob && !alpha && blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', TEXTURE_QUALITY[kind])
  if (!blob) throw new Error('This browser could not compress the textures.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type, width, height }
}

/** The browser's codec: the stored image is decoded untouched (no colour conversion, straight alpha) and handed to `encodeTexture`. */
export const browserCodec: TextureCodec = async (image, mimeType, kind, maxSide) => {
  const bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    return await encodeTexture(bitmap, kind, maxSide)
  } finally {
    bitmap.close()
  }
}
