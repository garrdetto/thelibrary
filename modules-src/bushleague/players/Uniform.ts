/** Club uniforms as shader parameters: every body mesh carries a slot per vertex, and one TSL material per player maps slots to the club's home or road colors and that player's skin tone, so any mesh can wear any of the 32 clubs. Jerseys add a lettering sheet (surname and number on the back, wordmark on the front) placed by the torso's wrap coordinates, and some clubs wear pinstripes. */
import * as THREE from 'three/webgpu'
import { abs, attribute, float, fract, mix, positionGeometry, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl'
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

const SPIKES = '#b9bdc4'
const SOLE = '#dcd8cc'

export const UMPIRE_UNIFORM: UniformColors = { jersey: '#1b2230', trim: '#1b2230', pants: '#5b616d', socks: '#15171c', cleats: '#15171c', cap: '#1b2230', belt: '#15171c' }

export const SKIN_TONES = ['#f1c7a5', '#e5b48f', '#d9a07a', '#b97c55', '#a8714a', '#7a4b2c', '#5d3a22', '#4a2d1c']

export interface PlayerMaterial {
  material: THREE.MeshStandardNodeMaterial
  set(colors: UniformColors, skin: string): void
}

export interface JerseyLook {
  lettering: THREE.Texture | null
  pinstripe: string | null
  /** The player's face sheet (brows, eyes, nose, lips, facial hair) laid over the skin on the front of the head. */
  face?: THREE.Texture | null
}

export function createPlayerMaterial(colors: UniformColors, skin: string, jersey: JerseyLook = { lettering: null, pinstripe: null }): PlayerMaterial {
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
    spikes: uniform(new THREE.Color(SPIKES)),
    sole: uniform(new THREE.Color(SOLE)),
  }
  type Vec3Node = ReturnType<typeof vec3>
  const asVec = (node: unknown) => node as Vec3Node
  let color: Vec3Node = asVec(u.skin)
  for (const [key, value] of Object.entries(SLOT)) {
    if (key === 'skin') continue
    color = mix(color, asVec(u[key as keyof typeof u]), pick(value)) as Vec3Node
  }
  const cloth = pick(SLOT.jersey).add(pick(SLOT.pants))
  if (jersey.pinstripe) {
    const line = smoothstep(float(0.9), float(0.96), abs(fract(positionGeometry.x.add(positionGeometry.z.mul(0.35)).mul(38)).sub(0.5)).mul(2))
    color = mix(color, asVec(uniform(new THREE.Color(jersey.pinstripe))), line.mul(cloth).mul(0.85)) as Vec3Node
  }
  if (jersey.lettering) {
    const wrap = attribute<'vec3'>('wrap', 'vec3')
    const height = wrap.y.sub(0.4).div(0.5)
    const inside = step(float(0), height).mul(step(height, float(1))).mul(step(abs(wrap.x), float(0.62))).mul(pick(SLOT.jersey))
    const back = step(wrap.z, float(0))
    const across = mix(float(0.5).add(wrap.x.mul(0.8)), float(0.5).sub(wrap.x.mul(0.8)), back)
    const sheet = texture(jersey.lettering, vec2(across, height.mul(0.5).add(back.mul(0.5))))
    color = mix(color, sheet.rgb, sheet.a.mul(inside)) as Vec3Node
  }
  if (jersey.face) {
    const head = attribute<'vec3'>('wrap', 'vec3')
    const onFace = step(float(1.14), head.y).mul(smoothstep(float(0.15), float(0.4), head.z))
    const features = texture(jersey.face, vec2(float(0.5).add(head.x.mul(0.6)), float(0.5).add(head.y.sub(1.88).mul(0.6))))
    color = mix(color, features.rgb, features.a.mul(onFace)) as Vec3Node
  }
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0 })
  material.colorNode = color
  material.roughnessNode = mix(float(0.78), float(0.35), pick(SLOT.cleats).add(pick(SLOT.cap).mul(0.4)).add(pick(SLOT.spikes)).add(pick(SLOT.sole).mul(0.5)))
  material.metalnessNode = pick(SLOT.spikes).mul(0.85)
  return {
    material,
    set(next, nextSkin) {
      u.skin.value.set(nextSkin)
      for (const key of ['jersey', 'trim', 'pants', 'socks', 'cleats', 'cap', 'belt'] as const) u[key].value.set(next[key])
    },
  }
}
