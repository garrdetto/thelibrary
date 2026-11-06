/** Club uniforms as shader parameters: every body mesh carries a slot per vertex, and one TSL material per player maps slots to the club's home or road colors and that player's skin tone, so any mesh can wear any of the 32 clubs. */
import * as THREE from 'three/webgpu'
import { attribute, float, mix, step, uniform, vec3 } from 'three/tsl'
import type { TeamColors } from '../sim'
import { SLOT } from './BodyMesh'

export interface UniformColors {
  jersey: string
  trim: string
  pants: string
  socks: string
  cleats: string
  cap: string
  belt: string
}

const HOME_WHITE = '#f1ede2'
const ROAD_GRAY = '#a9adb6'

/** Home whites with club trim, or the club's road look: colored jersey for bold clubs, road grays otherwise. */
export function teamUniform(colors: TeamColors, home: boolean): UniformColors {
  if (home) return { jersey: HOME_WHITE, trim: colors.primary, pants: HOME_WHITE, socks: colors.primary, cleats: '#15171c', cap: colors.primary, belt: colors.accent }
  const bold = new THREE.Color(colors.primary).getHSL({ h: 0, s: 0, l: 0 }).s > 0.45
  return bold
    ? { jersey: colors.primary, trim: colors.secondary, pants: ROAD_GRAY, socks: colors.secondary, cleats: '#15171c', cap: colors.primary, belt: colors.accent }
    : { jersey: ROAD_GRAY, trim: colors.primary, pants: ROAD_GRAY, socks: colors.primary, cleats: '#15171c', cap: colors.primary, belt: colors.accent }
}

export const UMPIRE_UNIFORM: UniformColors = { jersey: '#1b2230', trim: '#1b2230', pants: '#5b616d', socks: '#15171c', cleats: '#15171c', cap: '#1b2230', belt: '#15171c' }

export const SKIN_TONES = ['#f1c7a5', '#e5b48f', '#d9a07a', '#b97c55', '#a8714a', '#7a4b2c', '#5d3a22', '#4a2d1c']

export interface PlayerMaterial {
  material: THREE.MeshStandardNodeMaterial
  set(colors: UniformColors, skin: string): void
}

export function createPlayerMaterial(colors: UniformColors, skin: string): PlayerMaterial {
  const slot = attribute<'float'>('slot', 'float')
  const pick = (value: number) => step(float(value - 0.5), slot).mul(step(slot, float(value + 0.5)))
  const u = {
    skin: uniform(new THREE.Color(skin)),
    jersey: uniform(new THREE.Color(colors.jersey)),
    trim: uniform(new THREE.Color(colors.trim)),
    pants: uniform(new THREE.Color(colors.pants)),
    socks: uniform(new THREE.Color(colors.socks)),
    cleats: uniform(new THREE.Color(colors.cleats)),
    cap: uniform(new THREE.Color(colors.cap)),
    belt: uniform(new THREE.Color(colors.belt)),
  }
  type Vec3Node = ReturnType<typeof vec3>
  const asVec = (node: unknown) => node as Vec3Node
  let color: Vec3Node = asVec(u.skin)
  for (const [key, value] of Object.entries(SLOT)) {
    if (key === 'skin') continue
    color = mix(color, asVec(u[key as keyof typeof u]), pick(value)) as Vec3Node
  }
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0 })
  material.colorNode = color
  material.roughnessNode = mix(float(0.78), float(0.35), pick(SLOT.cleats).add(pick(SLOT.cap).mul(0.4)))
  return {
    material,
    set(next, nextSkin) {
      u.skin.value.set(nextSkin)
      for (const key of ['jersey', 'trim', 'pants', 'socks', 'cleats', 'cap', 'belt'] as const) u[key].value.set(next[key])
    },
  }
}
