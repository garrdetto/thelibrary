import { planContext } from './image-editor'
import type { ContextPlan, EditMode, Rect, SaveFormat } from './image-editor'

export const MAX_PIXELS = 40_000_000

type DirectoryHandle = {
  name: string
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}
type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandle>
export type SaveFolder = DirectoryHandle

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser can’t edit images. Try a current version of Chrome, Edge, Firefox or Safari.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

async function decode(url: string) {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  return image
}

export async function loadImageFile(file: File) {
  const url = URL.createObjectURL(file)
  try {
    let image: HTMLImageElement
    try { image = await decode(url) } catch { throw new Error(`${file.name} couldn’t be opened. Use PNG, JPEG or WebP.`) }
    if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error(`${file.name} is larger than 40 megapixels. Shrink it first.`)
    const canvas = makeCanvas(image.naturalWidth, image.naturalHeight)
    context2d(canvas).drawImage(image, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function thumbnail(source: HTMLCanvasElement, edge = 176) {
  const scale = Math.min(1, edge / Math.max(source.width, source.height))
  const canvas = makeCanvas(source.width * scale, source.height * scale)
  context2d(canvas).drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.8)
}

export function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = makeCanvas(source.width, source.height)
  canvas.getContext('2d')!.drawImage(source, 0, 0)
  return canvas
}

function outOfBounds(frame: Rect, width: number, height: number) {
  return frame.x < 0 || frame.y < 0 || frame.x + frame.w > width || frame.y + frame.h > height
}

export function contextImages(source: HTMLCanvasElement, selection: Rect, plan: ContextPlan) {
  const { frame, sendWidth, sendHeight } = plan
  const scale = sendWidth / frame.w
  const base = makeCanvas(sendWidth, sendHeight)
  const context = context2d(base)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, sendWidth, sendHeight)
  if (outOfBounds(frame, source.width, source.height)) {
    context.filter = 'blur(24px)'
    context.drawImage(source, 0, 0, sendWidth, sendHeight)
    context.filter = 'none'
  }
  context.drawImage(source, -frame.x * scale, -frame.y * scale, source.width * scale, source.height * scale)
  const guide = makeCanvas(sendWidth, sendHeight)
  const marked = context2d(guide)
  marked.drawImage(base, 0, 0)
  const sx = (selection.x - frame.x) * scale
  const sy = (selection.y - frame.y) * scale
  const sw = selection.w * scale
  const sh = selection.h * scale
  marked.fillStyle = 'rgba(0,0,0,.5)'
  marked.beginPath()
  marked.rect(0, 0, sendWidth, sendHeight)
  marked.rect(sx, sy, sw, sh)
  marked.fill('evenodd')
  const line = Math.max(3, Math.round(Math.max(sendWidth, sendHeight) / 320))
  marked.strokeStyle = '#ff00ff'
  marked.lineWidth = line
  marked.strokeRect(sx - line / 2, sy - line / 2, sw + line, sh + line)
  return { image: base.toDataURL('image/jpeg', 0.92), guide: guide.toDataURL('image/jpeg', 0.85) }
}

export async function compositeEdit(source: HTMLCanvasElement, selection: Rect, plan: ContextPlan, resultUrl: string) {
  const result = await decode(resultUrl)
  const { frame } = plan
  const feather = Math.min(14, Math.max(3, Math.round(Math.min(selection.w, selection.h) * 0.08)))
  const ring = Math.max(feather * 2, 12)
  const left = Math.max(0, frame.x, selection.x - ring)
  const top = Math.max(0, frame.y, selection.y - ring)
  const right = Math.min(source.width, frame.x + frame.w, selection.x + selection.w + ring)
  const bottom = Math.min(source.height, frame.y + frame.h, selection.y + selection.h + ring)
  const area = { x: left, y: top, w: right - left, h: bottom - top }
  const patch = makeCanvas(area.w, area.h)
  const patchContext = context2d(patch)
  const kx = result.naturalWidth / frame.w
  const ky = result.naturalHeight / frame.h
  patchContext.drawImage(result, (area.x - frame.x) * kx, (area.y - frame.y) * ky, area.w * kx, area.h * ky, 0, 0, area.w, area.h)
  const generated = patchContext.getImageData(0, 0, area.w, area.h).data
  const next = cloneCanvas(source)
  const nextContext = next.getContext('2d')!
  const original = nextContext.getImageData(area.x, area.y, area.w, area.h)
  const pixels = original.data
  const sx0 = selection.x - area.x
  const sy0 = selection.y - area.y
  const sx1 = sx0 + selection.w - 1
  const sy1 = sy0 + selection.h - 1
  const distance = (x: number, y: number) => Math.max(sx0 - x, 0, x - sx1, sy0 - y, 0, y - sy1)
  const sums = [0, 0, 0, 0, 0, 0]
  let count = 0
  for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
    const d = distance(x, y)
    if (d <= feather || d > ring) continue
    const i = (y * area.w + x) * 4
    if (pixels[i + 3] < 250) continue
    for (let c = 0; c < 3; c++) { sums[c] += pixels[i + c]; sums[c + 3] += generated[i + c] }
    count++
  }
  const shift = [0, 1, 2].map(c => count ? Math.max(-40, Math.min(40, (sums[c] - sums[c + 3]) / count)) : 0)
  for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
    const d = distance(x, y)
    if (d >= feather) continue
    const t = d / feather
    const a = d === 0 ? 1 : 1 - t * t * (3 - 2 * t)
    const i = (y * area.w + x) * 4
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * (1 - a) + Math.max(0, Math.min(255, generated[i + c] + shift[c])) * a)
    pixels[i + 3] = Math.round(pixels[i + 3] * (1 - a) + 255 * a)
  }
  nextContext.putImageData(original, area.x, area.y)
  return next
}

export async function requestEdit(source: HTMLCanvasElement, selection: Rect, mode: EditMode, prompt: string, signal?: AbortSignal) {
  const plan = planContext(selection, source.width, source.height)
  const { image, guide } = contextImages(source, selection, plan)
  let response: Response
  try {
    response = await fetch('/api/image-editor', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, prompt, image, guide, aspect: plan.aspect, size: plan.size }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('The image editor couldn’t be reached. Check your connection and try again.')
  }
  const data = await response.json().catch(() => ({})) as { image?: string; error?: string }
  if (!response.ok || !data.image) throw new Error(data.error || 'The edit didn’t work. Please try again.')
  return compositeEdit(source, selection, plan, data.image)
}

export function canvasBlob(canvas: HTMLCanvasElement, format: SaveFormat) {
  return new Promise<Blob>((resolve, reject) => {
    const source = format === 'image/jpeg' ? flatten(canvas) : canvas
    source.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image couldn’t be encoded.')), format, format === 'image/png' ? undefined : 0.95)
  })
}

function flatten(canvas: HTMLCanvasElement) {
  const flat = makeCanvas(canvas.width, canvas.height)
  const context = context2d(flat)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, flat.width, flat.height)
  context.drawImage(canvas, 0, 0)
  return flat
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function canPickFolder() {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === 'function'
}

export async function pickFolder(): Promise<SaveFolder | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  if (!picker) return null
  try { return await picker({ mode: 'readwrite', id: 'tl-image-editor' }) } catch { return null }
}

export async function fileExists(folder: SaveFolder, fileName: string) {
  try { await folder.getFileHandle(fileName); return true } catch { return false }
}

export async function writeToFolder(folder: SaveFolder, fileName: string, blob: Blob) {
  const handle = await folder.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}
