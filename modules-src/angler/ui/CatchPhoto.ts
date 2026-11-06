/** Catch photos: the current view of the lake with a caption strip (species, weight, length, tier, lake, time and angler), saved as a PNG. */
import type { World } from '../game/World'

export interface PhotoCaption {
  species: string
  weight: string
  length: string
  tier: string
  lake: string
  when: string
  angler: string
}

const TIER_COLORS: Record<string, string> = { Common: '#c9d6d8', Keeper: '#b8e0a8', Quality: '#7fd0ff', Trophy: '#ffcf4a', Legendary: '#ff8af0' }

export async function saveCatchPhoto(world: World, caption: PhotoCaption): Promise<void> {
  const shot = await world.snapshot()
  const w = shot.width, h = shot.height
  const scale = Math.max(1, w / 1280)
  const strip = Math.round(96 * scale)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h + strip
  const ctx = out.getContext('2d')
  if (!ctx) return
  ctx.drawImage(shot, 0, 0)
  const grad = ctx.createLinearGradient(0, h, 0, h + strip)
  grad.addColorStop(0, '#16303a')
  grad.addColorStop(1, '#0f2028')
  ctx.fillStyle = grad
  ctx.fillRect(0, h, w, strip)
  ctx.fillStyle = TIER_COLORS[caption.tier] ?? '#ffffff'
  ctx.fillRect(0, h, w, Math.round(4 * scale))
  const pad = Math.round(24 * scale)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${Math.round(34 * scale)}px Rajdhani, Inter, system-ui, sans-serif`
  ctx.fillText(`${caption.weight} ${caption.species}`, pad, h + Math.round(46 * scale))
  ctx.font = `600 ${Math.round(17 * scale)}px Inter, system-ui, sans-serif`
  ctx.fillStyle = '#a9bec2'
  ctx.fillText(`${caption.length} · ${caption.tier} · ${caption.lake} · ${caption.when} · ${caption.angler}`, pad, h + Math.round(76 * scale))
  ctx.textAlign = 'right'
  ctx.fillStyle = '#3fc7b6'
  ctx.font = `800 ${Math.round(20 * scale)}px Rajdhani, Inter, system-ui, sans-serif`
  ctx.fillText('Northwoods Angler · the library', w - pad, h + Math.round(46 * scale))
  const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'))
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `northwoods-${caption.species.toLowerCase().replace(/[^a-z]+/g, '-')}-${caption.weight.replace(/[^0-9a-z]+/gi, '')}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
