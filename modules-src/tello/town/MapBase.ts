/**
 * Montello painted once, two metres to the pixel, north up, from the baked data: ground cover with hill shading and
 * water, the woods and water past the city limits fading out, the city limits dashed, and (for Tello's own map) every
 * road by class and every building. Fox Lake's map (foxlake/town/Atlas.ts) takes the land only and draws Montello's
 * roads and buildings itself as vectors, so they stay sharp at any zoom. Map coordinates (x east, z north).
 */
import type { TelloLand } from '../region'

export const BASE_PX = 2048
export const COVER_RGB: readonly (readonly [number, number, number])[] = [[132, 142, 82], [112, 140, 78], [72, 104, 60], [104, 118, 80], [188, 172, 134], [128, 126, 120], [170, 158, 104], [58, 96, 124]]
export const ROAD_STYLE: readonly { color: string; casing: string; scale: number }[] = [
  { color: '#f2d27a', casing: '#5a4a22', scale: 1.5 },
  { color: '#f4f1e8', casing: '#55524a', scale: 1.25 },
  { color: '#dcd8cc', casing: '#6a665c', scale: 1 },
  { color: '#c9b792', casing: '#6b5d43', scale: 1 },
  { color: '#e8e4d6', casing: '', scale: 1 },
  { color: '#b99a6a', casing: '', scale: 1 },
]

/** A building's fill on the map, by kind. */
export function buildingFill(kind: string): string {
  return kind === 'store' ? '#c9896f' : kind === 'civic' ? '#d9b45c' : kind === 'industrial' ? '#a79cb5' : kind === 'house' ? '#d8c7ae' : '#b9ad9c'
}

/** Traces a flat ring (x, z pairs) through `px`/`pz` into a closed path, filled when asked. */
export function ring(g: CanvasRenderingContext2D, p: number[], px: (x: number) => number, pz: (z: number) => number, fill: boolean): void {
  g.beginPath()
  for (let k = 0; k < p.length; k += 2) {
    if (k === 0) g.moveTo(px(p[k]), pz(p[k + 1]))
    else g.lineTo(px(p[k]), pz(p[k + 1]))
  }
  g.closePath()
  if (fill) g.fill()
}

/**
 * The picture of Montello (`BASE_PX` square, covering `land.size` metres from `land.x0`, `land.z0`). With `vectors`
 * the lots, roads and buildings are painted into it too; `fade` darkens what lies outside the city limits.
 */
export function paintMontelloBase(land: TelloLand, opts: { vectors: boolean; fade?: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = BASE_PX
  canvas.height = BASE_PX
  const g = canvas.getContext('2d')!
  const n = land.side
  const { cover, ground, water, canopy } = land.grids
  const small = document.createElement('canvas')
  small.width = n
  small.height = n
  const sg = small.getContext('2d')!
  const img = sg.createImageData(n, n)
  const fade = opts.fade ?? 0.5
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const c = COVER_RGB[cover[k]] ?? COVER_RGB[0]
      let r = c[0], gg = c[1], b = c[2]
      const wet = water[k] > ground[k]
      if (wet) {
        const d = Math.min(1, (water[k] - ground[k]) / 300)
        r = 86 - d * 38; gg = 128 - d * 44; b = 150 - d * 30
      } else {
        const f = canopy[k] / 255
        r += (64 - r) * f * 0.6; gg += (98 - gg) * f * 0.6; b += (56 - b) * f * 0.6
        const e = ground[Math.min(n * n - 1, k + 1)] - ground[Math.max(0, k - 1)]
        const s = ground[Math.min(n * n - 1, k + n)] - ground[Math.max(0, k - n)]
        const shade = Math.max(0.72, Math.min(1.25, 1 + (s - e) * 0.0016))
        r *= shade; gg *= shade; b *= shade
      }
      const o = ((n - 1 - j) * n + i) * 4
      const play = land.grids.play[k] * 2
      const dim = play >= 0 ? 1 : fade
      img.data[o] = r * dim
      img.data[o + 1] = gg * dim
      img.data[o + 2] = b * dim
      img.data[o + 3] = play > -land.doc.limits.seen ? 255 : 0
    }
  }
  sg.putImageData(img, 0, 0)
  g.imageSmoothingEnabled = true
  g.drawImage(small, 0, 0, BASE_PX, BASE_PX)
  const s = BASE_PX / land.size
  const px = (x: number) => (x - land.x0) * s
  const pz = (z: number) => (land.z0 + land.size - z) * s
  if (opts.vectors) {
    g.fillStyle = 'rgba(96,94,90,.85)'
    for (const lot of land.doc.lots) ring(g, lot.p, px, pz, true)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const pass of [0, 1]) {
      for (const kind of [5, 4, 3, 2, 1, 0]) {
        const style = ROAD_STYLE[kind]
        if (pass === 0 && !style.casing) continue
        for (const road of land.doc.roads) {
          if (road.k !== kind) continue
          g.strokeStyle = pass === 0 ? style.casing : style.color
          g.lineWidth = Math.max(1, road.w * s * style.scale) + (pass === 0 ? 2 : 0)
          g.beginPath()
          for (let k = 0; k < road.p.length; k += 2) {
            if (k === 0) g.moveTo(px(road.p[k]), pz(road.p[k + 1]))
            else g.lineTo(px(road.p[k]), pz(road.p[k + 1]))
          }
          g.stroke()
        }
      }
    }
    for (const b of land.doc.buildings) {
      g.fillStyle = buildingFill(b.k)
      g.strokeStyle = 'rgba(40,34,28,.55)'
      g.lineWidth = 0.6
      ring(g, b.p, px, pz, true)
      g.stroke()
    }
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(small, 0, 0, BASE_PX, BASE_PX)
    g.globalCompositeOperation = 'source-over'
  }
  g.setLineDash([10, 6])
  g.strokeStyle = 'rgba(255,240,200,.75)'
  g.lineWidth = 2
  ring(g, land.doc.limits.city, px, pz, false)
  g.stroke()
  g.setLineDash([])
  return canvas
}
