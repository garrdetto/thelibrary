import type { WeaponReadout } from '../weapons/WeaponSystem'
import { ARENA_MAX_HEALTH } from '../../../../server/arena/protocol.mjs'

const FEED_LIMIT = 4
const FEED_LIFE = 5000

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

export class Hud {
  private readonly weaponName = element('weapon-name')
  private readonly ammo = element('weapon-ammo')
  private readonly rounds = element('weapon-rounds')
  private readonly reload = element<HTMLDivElement>('weapon-reload')
  private readonly health = element<HTMLDivElement>('health-fill')
  private readonly healthText = element('health-text')
  private readonly hitmarker = element('hitmarker')
  private readonly damage = element('damage')
  private readonly dead = element('dead')
  private readonly feed = element('killfeed')
  private readonly crosshair = element('crosshair')
  private lastAmmo = ''
  private lastHealth = -1
  private hitTimer = 0
  private damageTimer = 0

  weapon(readout: WeaponReadout): void {
    if (this.weaponName && this.weaponName.textContent !== readout.name) this.weaponName.textContent = readout.name
    const ammo = readout.reloading ? 'Reloading' : String(readout.ammo)
    if (this.ammo && ammo !== this.lastAmmo) {
      this.ammo.textContent = ammo
      this.ammo.classList.toggle('low', !readout.reloading && readout.ammo <= Math.ceil(readout.magazine / 5))
      this.lastAmmo = ammo
      if (this.rounds) {
        this.rounds.style.setProperty('--magazine', String(readout.magazine))
        this.rounds.style.setProperty('--share', String(readout.reloading ? 0 : readout.ammo / readout.magazine))
      }
    }
    if (this.reload) this.reload.style.transform = `scaleX(${readout.reloading ? readout.reloadProgress : 0})`
    if (this.crosshair) this.crosshair.style.setProperty('--gap', `${Math.round(4 + readout.spread * 260)}px`)
  }

  setHealth(value: number): void {
    if (value === this.lastHealth) return
    if (value < this.lastHealth) this.hurt()
    this.lastHealth = value
    const share = Math.max(0, Math.min(1, value / ARENA_MAX_HEALTH))
    if (this.health) {
      this.health.style.transform = `scaleX(${share})`
      this.health.classList.toggle('low', share <= 0.3)
    }
    if (this.healthText) this.healthText.textContent = String(Math.ceil(value))
  }

  hit(headshot: boolean, kill = false): void {
    if (!this.hitmarker) return
    this.hitmarker.className = kill ? 'show kill' : headshot ? 'show head' : 'show'
    window.clearTimeout(this.hitTimer)
    this.hitTimer = window.setTimeout(() => { if (this.hitmarker) this.hitmarker.className = '' }, kill ? 400 : 160)
  }

  private hurt(): void {
    if (!this.damage) return
    this.damage.classList.add('show')
    window.clearTimeout(this.damageTimer)
    this.damageTimer = window.setTimeout(() => this.damage?.classList.remove('show'), 220)
  }

  setDead(dead: boolean, by?: string): void {
    if (!this.dead) return
    this.dead.textContent = dead ? `Eliminated${by ? ` by ${by}` : ''} · respawning…` : ''
    this.dead.classList.toggle('show', dead)
    document.body.classList.toggle('dead', dead)
  }

  announce(text: string): void {
    if (!this.feed) return
    const line = document.createElement('div')
    line.textContent = text
    this.feed.prepend(line)
    while (this.feed.children.length > FEED_LIMIT) this.feed.lastElementChild?.remove()
    window.setTimeout(() => line.remove(), FEED_LIFE)
  }
}
