/** Landing celebrations drawn over the lake: the weight floating up from the angler, confetti for trophies and records, and a golden flash for legendary fish. Skips the motion when the viewer prefers reduced motion. */
import * as pc from 'playcanvas'
import type { World } from '../game/World'

const COLORS = ['#ffcf4a', '#3fc7b6', '#ff8af0', '#7fd0ff', '#7bd88f', '#ffffff', '#ff7a5a']
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export class Celebrate {
  constructor(private readonly world: World, private readonly layer: HTMLElement) {}

  /** A label that rises from just above the angler's head and fades out. */
  float(text: string, tier: string): void {
    const cam = this.world.camera?.entity.camera
    const p = this.world.player?.character.entity.getPosition()
    if (!cam || !p) return
    const screen = cam.worldToScreen(new pc.Vec3(p.x, p.y + 2.1, p.z), new pc.Vec3())
    const el = document.createElement('div')
    el.className = `ang-float tier-${tier.toLowerCase()}`
    el.textContent = text
    el.style.left = `${Math.round(screen.x)}px`
    el.style.top = `${Math.round(screen.y)}px`
    this.layer.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }

  confetti(pieces = 90): void {
    if (reduced()) return
    const box = document.createElement('div')
    box.className = 'ang-confetti'
    box.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('i')
      piece.style.left = `${Math.random() * 100}%`
      piece.style.background = COLORS[i % COLORS.length]
      piece.style.animationDelay = `${Math.random() * 0.6}s`
      piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`)
      piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`)
      piece.style.width = `${6 + Math.random() * 6}px`
      piece.style.height = `${8 + Math.random() * 8}px`
      box.appendChild(piece)
    }
    document.body.appendChild(box)
    setTimeout(() => box.remove(), 4600)
  }

  flash(): void {
    if (reduced()) return
    const el = document.createElement('div')
    el.className = 'ang-flash'
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1200)
  }
}
