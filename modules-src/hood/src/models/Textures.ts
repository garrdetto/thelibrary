/** Procedural surface textures drawn once on canvases: lap siding, shingles, planks, tile, carpet, pavers, grass, asphalt, concrete and fence boards. */
import * as THREE from 'three/webgpu'

export type TextureName = 'siding' | 'plaster' | 'shingles' | 'planks' | 'tile' | 'carpet' | 'pavers' | 'grass' | 'asphalt' | 'concrete' | 'boards' | 'stone' | 'bark' | 'leaves' | 'grain' | 'fabric' | 'batten' | 'shake' | 'brick' | 'stucco' | 'panel' | 'metal' | 'clay' | 'slate' | 'gravel' | 'herringbone' | 'hex' | 'marble' | 'stripes'

const cache = new Map<TextureName, THREE.CanvasTexture>()

/** Small seeded generator so every texture looks the same on every visit. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!]
}

function speckle(g: CanvasRenderingContext2D, size: number, random: () => number, count: number, colors: string[], min: number, max: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(random() * colors.length)]
    const r = min + random() * (max - min)
    g.fillRect(random() * size, random() * size, r, r)
  }
}

const painters: Record<TextureName, (g: CanvasRenderingContext2D, size: number, random: () => number) => void> = {
  siding: (g, size, random) => {
    const boards = 10
    const h = size / boards
    for (let i = 0; i < boards; i++) {
      const y = i * h
      const grad = g.createLinearGradient(0, y, 0, y + h)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.82, '#eeeeee')
      grad.addColorStop(0.9, '#c9c9c9')
      grad.addColorStop(1, '#a8a8a8')
      g.fillStyle = grad
      g.fillRect(0, y, size, h)
      g.globalAlpha = 0.05
      for (let k = 0; k < 40; k++) {
        g.fillStyle = random() < 0.5 ? '#000' : '#fff'
        g.fillRect(random() * size, y + random() * h * 0.8, 20 + random() * 80, 1)
      }
      g.globalAlpha = 1
    }
  },
  plaster: (g, size, random) => {
    g.fillStyle = '#f7f7f7'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.06
    speckle(g, size, random, 2400, ['#000', '#fff'], 1, 3)
    g.globalAlpha = 1
  },
  shingles: (g, size, random) => {
    g.fillStyle = '#7a7a7a'
    g.fillRect(0, 0, size, size)
    const rows = 8
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      const tab = size / 6
      const shift = (r % 2) * tab / 2
      for (let x = -tab; x < size + tab; x += tab) {
        const shade = 200 + Math.floor(random() * 55)
        g.fillStyle = `rgb(${shade},${shade},${shade})`
        g.fillRect(x + shift + 1.5, r * h + 1, tab - 3, h - 2)
        g.globalAlpha = 0.18
        g.fillStyle = '#000'
        g.fillRect(x + shift + 1.5, r * h + h - 5, tab - 3, 4)
        g.globalAlpha = 0.08
        for (let k = 0; k < 18; k++) {
          g.fillStyle = random() < 0.5 ? '#000' : '#fff'
          g.fillRect(x + shift + random() * tab, r * h + random() * h, 2, 2)
        }
        g.globalAlpha = 1
      }
    }
  },
  planks: (g, size, random) => {
    const rows = 8
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      let x = -random() * size * 0.5
      while (x < size) {
        const length = size * (0.35 + random() * 0.45)
        const shade = 214 + Math.floor(random() * 41)
        g.fillStyle = `rgb(${shade},${shade},${shade})`
        g.fillRect(x, r * h, length, h)
        g.globalAlpha = 0.1
        for (let k = 0; k < 6; k++) {
          g.fillStyle = '#000'
          g.fillRect(x, r * h + random() * h, length, 1)
        }
        g.globalAlpha = 0.45
        g.fillStyle = '#6b6b6b'
        g.fillRect(x, r * h, 2, h)
        g.globalAlpha = 1
        x += length
      }
      g.fillStyle = '#7a7a7a'
      g.fillRect(0, r * h + h - 1.5, size, 1.5)
    }
  },
  tile: (g, size, random) => {
    const n = 4
    const t = size / n
    g.fillStyle = '#9c9c9c'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const shade = 232 + Math.floor(random() * 23)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
      const grad = g.createLinearGradient(i * t, j * t, i * t + t, j * t + t)
      grad.addColorStop(0, 'rgba(255,255,255,0.25)')
      grad.addColorStop(1, 'rgba(0,0,0,0.05)')
      g.fillStyle = grad
      g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
    }
  },
  carpet: (g, size, random) => {
    g.fillStyle = '#e8e8e8'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.18
    speckle(g, size, random, 9000, ['#ffffff', '#bdbdbd', '#d5d5d5'], 1, 2)
    g.globalAlpha = 1
  },
  pavers: (g, size, random) => {
    g.fillStyle = '#8a8a8a'
    g.fillRect(0, 0, size, size)
    const rows = 4
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      const w = size / 3
      const shift = (r % 2) * w / 2
      for (let x = -w; x < size + w; x += w) {
        const shade = 205 + Math.floor(random() * 45)
        g.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`
        g.fillRect(x + shift + 3, r * h + 3, w - 6, h - 6)
      }
    }
    g.globalAlpha = 0.12
    speckle(g, size, random, 3000, ['#000', '#fff'], 1, 2)
    g.globalAlpha = 1
  },
  grass: (g, size, random) => {
    g.fillStyle = '#6a9a45'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 60; i++) {
      const x = random() * size, y = random() * size, r = 20 + random() * 60
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      const tone = random() < 0.5 ? 'rgba(120,160,70,0.35)' : 'rgba(70,110,45,0.35)'
      grad.addColorStop(0, tone)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
    const blades = ['#4c7a31', '#6c9d45', '#7fb052', '#3f6a2a', '#8bbd5c']
    for (let i = 0; i < 14000; i++) {
      g.strokeStyle = blades[Math.floor(random() * blades.length)]
      g.globalAlpha = 0.5 + random() * 0.5
      g.lineWidth = 1
      const x = random() * size, y = random() * size, l = 3 + random() * 6, a = -Math.PI / 2 + (random() - 0.5) * 0.9
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      g.stroke()
    }
    g.globalAlpha = 1
  },
  asphalt: (g, size, random) => {
    g.fillStyle = '#45484d'
    g.fillRect(0, 0, size, size)
    speckle(g, size, random, 16000, ['#35383c', '#55585d', '#5f6166', '#2d2f33'], 1, 2.5)
    g.globalAlpha = 0.25
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = '#26282b'
      g.lineWidth = 1.5
      g.beginPath()
      let x = random() * size, y = random() * size
      g.moveTo(x, y)
      for (let k = 0; k < 8; k++) { x += (random() - 0.5) * 40; y += (random() - 0.5) * 40; g.lineTo(x, y) }
      g.stroke()
    }
    g.globalAlpha = 1
  },
  concrete: (g, size, random) => {
    g.fillStyle = '#d2cfc8'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.2
    speckle(g, size, random, 7000, ['#bdb9b1', '#e2dfd9', '#c7c3bb'], 1, 2.5)
    g.globalAlpha = 0.6
    g.fillStyle = '#a19d95'
    g.fillRect(0, 0, size, 2)
    g.fillRect(0, 0, 2, size)
    g.globalAlpha = 1
  },
  boards: (g, size, random) => {
    const n = 8
    const w = size / n
    for (let i = 0; i < n; i++) {
      const shade = 200 + Math.floor(random() * 55)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.fillRect(i * w, 0, w, size)
      g.globalAlpha = 0.12
      for (let k = 0; k < 10; k++) { g.fillStyle = '#000'; g.fillRect(i * w + random() * w, 0, 1, size) }
      g.globalAlpha = 0.6
      g.fillStyle = '#5a5a5a'
      g.fillRect(i * w, 0, 2, size)
      g.globalAlpha = 1
    }
  },
  stone: (g, size, random) => {
    g.fillStyle = '#7d7a74'
    g.fillRect(0, 0, size, size)
    const rows = 4
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      let x = -random() * 40
      while (x < size) {
        const w = 40 + random() * 60
        const shade = 150 + Math.floor(random() * 70)
        g.fillStyle = `rgb(${shade},${shade - 3},${shade - 8})`
        g.fillRect(x + 2, r * h + 2, w - 4, h - 4)
        x += w
      }
    }
  },
  bark: (g, size, random) => {
    g.fillStyle = '#9a9a9a'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 160; i++) {
      g.fillStyle = random() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.12)'
      g.fillRect(random() * size, 0, 1 + random() * 3, size)
    }
  },
  grain: (g, size, random) => {
    g.fillStyle = '#ececec'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 70; i++) {
      const y0 = random() * size
      const shade = 150 + Math.floor(random() * 90)
      g.strokeStyle = `rgba(${shade},${shade},${shade},${0.25 + random() * 0.35})`
      g.lineWidth = 0.6 + random() * 1.6
      g.beginPath()
      g.moveTo(0, y0)
      for (let x = 0; x <= size; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.03 + i) * (2 + random() * 3))
      g.stroke()
    }
  },
  fabric: (g, size, random) => {
    g.fillStyle = '#e6e6e6'
    g.fillRect(0, 0, size, size)
    for (let y = 0; y < size; y += 3) {
      g.fillStyle = y % 6 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.12)'
      g.fillRect(0, y, size, 1)
    }
    for (let x = 0; x < size; x += 3) {
      g.fillStyle = x % 6 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.2)'
      g.fillRect(x, 0, 1, size)
    }
    g.globalAlpha = 0.1
    speckle(g, size, random, 1500, ['#000', '#fff'], 1, 2)
    g.globalAlpha = 1
  },
  batten: (g, size, random) => {
    g.fillStyle = '#f2f2f2'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.05
    speckle(g, size, random, 900, ['#000', '#fff'], 1, 3)
    g.globalAlpha = 1
    const n = 5
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * size / n
      const grad = g.createLinearGradient(x - 6, 0, x + 6, 0)
      grad.addColorStop(0, '#b9b9b9')
      grad.addColorStop(0.25, '#ffffff')
      grad.addColorStop(0.8, '#e9e9e9')
      grad.addColorStop(1, '#a5a5a5')
      g.fillStyle = grad
      g.fillRect(x - 6, 0, 12, size)
    }
  },
  shake: (g, size, random) => {
    g.fillStyle = '#7d7d7d'
    g.fillRect(0, 0, size, size)
    const rows = 8
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      let x = -random() * 20
      while (x < size) {
        const w = 14 + random() * 26
        const shade = 190 + Math.floor(random() * 60)
        g.fillStyle = `rgb(${shade},${shade},${shade})`
        g.fillRect(x + 1, r * h, w - 2, h - 1)
        g.globalAlpha = 0.25
        g.fillStyle = '#000'
        g.fillRect(x + 1, r * h + h - 4, w - 2, 3)
        g.globalAlpha = 0.08
        for (let k = 0; k < 4; k++) g.fillRect(x + 2 + random() * (w - 4), r * h, 1, h - 4)
        g.globalAlpha = 1
        x += w
      }
    }
  },
  brick: (g, size, random) => {
    g.fillStyle = '#e8e4dc'
    g.fillRect(0, 0, size, size)
    const rows = 12
    const h = size / rows
    const w = size / 4
    for (let r = 0; r < rows; r++) {
      const shift = (r % 2) * w / 2
      for (let x = -w; x < size + w; x += w) {
        const shade = 150 + Math.floor(random() * 80)
        g.fillStyle = `rgb(${shade},${Math.floor(shade * 0.96)},${Math.floor(shade * 0.92)})`
        g.fillRect(x + shift + 2, r * h + 2, w - 4, h - 4)
        g.globalAlpha = 0.15
        for (let k = 0; k < 10; k++) { g.fillStyle = random() < 0.5 ? '#000' : '#fff'; g.fillRect(x + shift + 2 + random() * (w - 6), r * h + 2 + random() * (h - 6), 2, 2) }
        g.globalAlpha = 1
      }
    }
  },
  stucco: (g, size, random) => {
    g.fillStyle = '#f0f0f0'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.12
    speckle(g, size, random, 7000, ['#bdbdbd', '#ffffff', '#d6d6d6'], 1, 3)
    g.globalAlpha = 0.05
    for (let i = 0; i < 40; i++) {
      const x = random() * size, y = random() * size, r = 10 + random() * 30
      g.fillStyle = random() < 0.5 ? '#000' : '#fff'
      g.beginPath(); g.ellipse(x, y, r, r * 0.4, random() * 3, 0, Math.PI * 2); g.fill()
    }
    g.globalAlpha = 1
  },
  panel: (g, size, random) => {
    g.fillStyle = '#f2f2f2'
    g.fillRect(0, 0, size, size)
    g.globalAlpha = 0.05
    speckle(g, size, random, 600, ['#000', '#fff'], 1, 3)
    g.globalAlpha = 1
    g.fillStyle = '#8f8f8f'
    for (let i = 0; i < 2; i++) g.fillRect(0, i * size / 2, size, 2)
    for (let i = 0; i < 2; i++) g.fillRect(i * size / 2 + (i ? size / 4 : 0), 0, 2, size)
  },
  metal: (g, size, random) => {
    g.fillStyle = '#d8d8d8'
    g.fillRect(0, 0, size, size)
    const n = 6
    for (let i = 0; i < n; i++) {
      const x = i * size / n
      const grad = g.createLinearGradient(x, 0, x + size / n, 0)
      grad.addColorStop(0, '#9a9a9a')
      grad.addColorStop(0.06, '#ffffff')
      grad.addColorStop(0.12, '#dcdcdc')
      grad.addColorStop(1, '#cfcfcf')
      g.fillStyle = grad
      g.fillRect(x, 0, size / n, size)
    }
    g.globalAlpha = 0.04
    speckle(g, size, random, 400, ['#000'], 1, 2)
    g.globalAlpha = 1
  },
  clay: (g, size, random) => {
    g.fillStyle = '#6f6f6f'
    g.fillRect(0, 0, size, size)
    const rows = 6
    const h = size / rows
    const w = size / 6
    for (let r = 0; r < rows; r++) for (let c = 0; c < 6; c++) {
      const x = c * w + (r % 2) * w / 2
      const grad = g.createLinearGradient(x, 0, x + w, 0)
      const base = 190 + Math.floor(random() * 50)
      grad.addColorStop(0, `rgb(${base - 70},${base - 70},${base - 70})`)
      grad.addColorStop(0.5, `rgb(${base},${base},${base})`)
      grad.addColorStop(1, `rgb(${base - 80},${base - 80},${base - 80})`)
      g.fillStyle = grad
      g.fillRect(x, r * h, w - 1, h - 2)
      g.fillRect(x - size, r * h, w - 1, h - 2)
    }
  },
  slate: (g, size, random) => {
    g.fillStyle = '#4a4a4a'
    g.fillRect(0, 0, size, size)
    const rows = 10
    const h = size / rows
    for (let r = 0; r < rows; r++) {
      const w = size / 8
      const shift = (r % 2) * w / 2
      for (let x = -w; x < size + w; x += w) {
        const shade = 150 + Math.floor(random() * 70)
        g.fillStyle = `rgb(${shade},${shade},${shade + 6})`
        g.fillRect(x + shift + 1, r * h + 1, w - 2, h - 2)
      }
    }
  },
  gravel: (g, size, random) => {
    g.fillStyle = '#bdbdbd'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 5000; i++) {
      const shade = 140 + Math.floor(random() * 115)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.beginPath(); g.ellipse(random() * size, random() * size, 1.5 + random() * 3, 1 + random() * 2.5, random() * 3, 0, Math.PI * 2); g.fill()
    }
  },
  herringbone: (g, size, random) => {
    g.fillStyle = '#8a8a8a'
    g.fillRect(0, 0, size, size)
    const u = size / 8
    for (let i = -8; i < 16; i++) for (let j = -8; j < 16; j++) {
      const shade = 205 + Math.floor(random() * 50)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.save()
      const x = i * u * 2 + j * u, y = j * u
      g.translate(x, y)
      g.rotate((i + j) % 2 ? Math.PI / 4 : -Math.PI / 4)
      g.fillRect(1, 1, u * 2 - 2, u / 2 - 2)
      g.restore()
    }
  },
  hex: (g, size, random) => {
    g.fillStyle = '#9a9a9a'
    g.fillRect(0, 0, size, size)
    const r = size / 8
    const hgt = Math.sqrt(3) * r
    for (let col = -1; col < 6; col++) for (let row = -1; row < 6; row++) {
      const cx = col * r * 1.5, cy = row * hgt + (col % 2 ? hgt / 2 : 0)
      const shade = 230 + Math.floor(random() * 25)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.beginPath()
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)) }
      g.closePath(); g.fill()
    }
  },
  marble: (g, size, random) => {
    g.fillStyle = '#f4f4f4'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(120,120,130,${0.15 + random() * 0.25})`
      g.lineWidth = 0.6 + random() * 1.4
      g.beginPath()
      let x = random() * size, y = random() * size
      g.moveTo(x, y)
      for (let k = 0; k < 10; k++) { x += (random() - 0.3) * 40; y += (random() - 0.5) * 30; g.lineTo(x, y) }
      g.stroke()
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(0, 0, size, 1)
    g.fillRect(0, 0, 1, size)
  },
  stripes: (g, size) => {
    const n = 8
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#7a7a7a'
      g.fillRect(i * size / n, 0, size / n, size)
    }
  },
  leaves: (g, size, random) => {
    g.fillStyle = '#b5b5b5'
    g.fillRect(0, 0, size, size)
    for (let i = 0; i < 2600; i++) {
      const shade = 140 + Math.floor(random() * 115)
      g.fillStyle = `rgb(${shade},${shade},${shade})`
      g.beginPath()
      g.ellipse(random() * size, random() * size, 2 + random() * 4, 1.5 + random() * 2.5, random() * Math.PI, 0, Math.PI * 2)
      g.fill()
    }
  },
}

const SIZES: Partial<Record<TextureName, number>> = { grass: 512, asphalt: 512, carpet: 256, plaster: 256 }

export function surfaceTexture(name: TextureName): THREE.CanvasTexture {
  let texture = cache.get(name)
  if (texture) return texture
  const size = SIZES[name] ?? 256
  const [c, g] = canvas(size)
  painters[name](g, size, rng(name.length * 7919 + name.charCodeAt(0)))
  texture = new THREE.CanvasTexture(c)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  cache.set(name, texture)
  return texture
}
