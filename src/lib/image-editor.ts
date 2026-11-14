export const EDIT_MODES = ['remove', 'edit', 'fill'] as const
export type EditMode = (typeof EDIT_MODES)[number]

export const EDIT_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type EditAspect = (typeof EDIT_ASPECTS)[number]

export const EDIT_SIZES = ['1K', '2K'] as const
export type EditSize = (typeof EDIT_SIZES)[number]

export const SAVE_FORMATS = ['image/png', 'image/jpeg', 'image/webp'] as const
export type SaveFormat = (typeof SAVE_FORMATS)[number]

export const EDIT_PROMPT_LIMIT = 600
export const MAX_SEND_EDGE = 1536
export const MIN_SEND_EDGE = 768

export type Rect = { x: number; y: number; w: number; h: number }

export type ContextPlan = {
  frame: Rect
  aspect: EditAspect
  sendWidth: number
  sendHeight: number
  size: EditSize
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function aspectRatio(aspect: EditAspect) {
  const [width, height] = aspect.split(':').map(Number)
  return width / height
}

export function closestAspect(width: number, height: number): EditAspect {
  const target = Math.log(width / height)
  const distance = (aspect: EditAspect) => Math.abs(Math.log(aspectRatio(aspect)) - target)
  return EDIT_ASPECTS.reduce((best, aspect) => distance(aspect) < distance(best) ? aspect : best)
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = clamp(Math.round(Math.min(rect.x, rect.x + rect.w)), 0, width)
  const y = clamp(Math.round(Math.min(rect.y, rect.y + rect.h)), 0, height)
  const right = clamp(Math.round(Math.max(rect.x, rect.x + rect.w)), 0, width)
  const bottom = clamp(Math.round(Math.max(rect.y, rect.y + rect.h)), 0, height)
  return { x, y, w: right - x, h: bottom - y }
}

export function scaleRect(rect: Rect, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number): Rect {
  const sx = toWidth / fromWidth
  const sy = toHeight / fromHeight
  return clampRect({ x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy }, toWidth, toHeight)
}

export function planContext(selection: Rect, imageWidth: number, imageHeight: number): ContextPlan {
  const margin = Math.max(48, Math.round(Math.max(selection.w, selection.h) * 0.6))
  const pad = 8
  let width = Math.min(selection.w + margin * 2, imageWidth)
  let height = Math.min(selection.h + margin * 2, imageHeight)
  const aspect = closestAspect(width, height)
  const ratio = aspectRatio(aspect)
  if (width / height < ratio) {
    const wider = height * ratio
    if (wider <= imageWidth) width = wider
    else {
      width = imageWidth
      height = Math.max(width / ratio, selection.h + pad * 2)
      width = height * ratio
    }
  } else {
    const taller = width / ratio
    if (taller <= imageHeight) height = taller
    else {
      height = imageHeight
      width = Math.max(height * ratio, selection.w + pad * 2)
      height = width / ratio
    }
  }
  width = Math.round(width)
  height = Math.round(height)
  const centerX = selection.x + selection.w / 2
  const centerY = selection.y + selection.h / 2
  const x = width <= imageWidth ? clamp(Math.round(centerX - width / 2), 0, imageWidth - width) : Math.round((imageWidth - width) / 2)
  const y = height <= imageHeight ? clamp(Math.round(centerY - height / 2), 0, imageHeight - height) : Math.round((imageHeight - height) / 2)
  const longEdge = Math.max(width, height)
  const scale = Math.min(MAX_SEND_EDGE / longEdge, Math.max(1, MIN_SEND_EDGE / longEdge))
  const sendWidth = Math.max(1, Math.round(width * scale))
  const sendHeight = Math.max(1, Math.round(height * scale))
  return { frame: { x, y, w: width, h: height }, aspect, sendWidth, sendHeight, size: Math.max(sendWidth, sendHeight) > 1100 ? '2K' : '1K' }
}

export function cleanBaseName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80)
}

export function nameKey(name: string) {
  return (cleanBaseName(name) || 'image').toLowerCase()
}

export function fileExtension(format: SaveFormat) {
  return format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png'
}

export function saveFileName(base: string, number: number, format: SaveFormat) {
  return `${cleanBaseName(base) || 'image'}${number}.${fileExtension(format)}`
}

export function saveFormatFor(mime: string): SaveFormat {
  return (SAVE_FORMATS as readonly string[]).includes(mime) ? mime as SaveFormat : 'image/png'
}

export function baseNameOf(fileName: string) {
  return cleanBaseName(fileName.replace(/\.[^.]+$/, ''))
}
