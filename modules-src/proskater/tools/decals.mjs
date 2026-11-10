// Draws the rider's uniform decals as PNGs for build-models.py to project onto the Meshy texture.
//   node modules-src/proskater/tools/decals.mjs
// skate.png      yellow SKATE lettering for the left thigh pocket flap
// patch.png      blue shield patch with a dark blue outline and a gold star (hat front, left sleeve)
// flag.png       United States flag patch (right sleeve)
// rank-2.png     two chevrons (Officer), rank-3.png three chevrons (Sergeant), both sleeves
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const out = join(root, 'assets-src', 'proskater', 'decals')
mkdirSync(out, { recursive: true })

const star = (cx, cy, r, fill) => {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.42 : r
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}

const decals = {
  skate: [512, 160, `
    <text x="256" y="122" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="128" letter-spacing="6" fill="#f2c318" stroke="#b88a00" stroke-width="3">SKATE</text>`],
  patch: [400, 480, `
    <path d="M200 14 C 270 44 330 50 380 46 L 380 250 C 380 350 300 420 200 466 C 100 420 20 350 20 250 L 20 46 C 70 50 130 44 200 14 Z" fill="#14285c"/>
    <path d="M200 40 C 262 66 318 72 356 70 L 356 250 C 356 335 288 396 200 438 C 112 396 44 335 44 250 L 44 70 C 82 72 138 66 200 40 Z" fill="#2f6fd0"/>
    <path d="M200 62 C 256 86 304 92 336 92 L 336 248 C 336 322 278 376 200 414 C 122 376 64 322 64 248 L 64 92 C 96 92 144 86 200 62 Z" fill="none" stroke="#9cc3ff" stroke-width="5"/>
    ${star(200, 230, 92, '#f2c318')}`],
  flag: [570, 300, (() => {
    let s = ''
    for (let i = 0; i < 13; i++) s += `<rect x="0" y="${(i * 300) / 13}" width="570" height="${300 / 13 + 0.6}" fill="${i % 2 ? '#ffffff' : '#b22234'}"/>`
    s += `<rect x="0" y="0" width="228" height="${(300 * 7) / 13}" fill="#3c3b6e"/>`
    for (let r = 0; r < 9; r++) {
      const cols = r % 2 ? 5 : 6
      for (let c = 0; c < cols; c++) s += star(19 + c * 38 + (r % 2 ? 19 : 0), 12 + r * 14.6, 6.5, '#ffffff')
    }
    return s + '<rect x="3" y="3" width="564" height="294" fill="none" stroke="#1a1a2e" stroke-width="6"/>'
  })()],
  'rank-2': [400, 320, chevrons(2)],
  'rank-3': [400, 420, chevrons(3)],
}

function chevrons(count) {
  let s = ''
  for (let i = 0; i < count; i++) {
    const y = 40 + i * 96
    const path = `M 20 ${y + 110} L 200 ${y} L 380 ${y + 110} L 380 ${y + 170} L 200 ${y + 60} L 20 ${y + 170} Z`
    s += `<path d="${path}" fill="#14285c" stroke="#f2c318" stroke-width="9" stroke-linejoin="round"/>`
  }
  return s
}

for (const [name, [w, h, body]] of Object.entries(decals)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
  await sharp(Buffer.from(svg)).png().toFile(join(out, `${name}.png`))
  console.log('wrote', `${name}.png`, `${w}x${h}`)
}
