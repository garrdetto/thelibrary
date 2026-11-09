/** Dresses a park in the home club's colours: seats, wall padding, the fence cap, distance signs and the scoreboard lettering, pushed bright and saturated so the ballpark reads modern and colourful. Wood parks keep their boards, painted in the club colour. */
import * as THREE from 'three/webgpu'
import type { TeamColors } from '../sim'
import type { ParkTheme } from '../looks'

export interface TeamDress {
  theme: ParkTheme
  fenceTop: string
  signPaint: string
  scoreboardTitle: string
}

function vivid(hex: string, minLightness: number, maxLightness: number, minSaturation = 0.6): string {
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(hex).getHSL(hsl)
  const saturation = hsl.s < 0.12 ? hsl.s : Math.max(hsl.s, minSaturation)
  const lightness = Math.min(maxLightness, Math.max(minLightness, hsl.l))
  return `#${new THREE.Color().setHSL(hsl.h, saturation, lightness).getHexString()}`
}

function blend(a: string, b: string, amount: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), amount).getHexString()}`
}

function brightest(colors: TeamColors): string {
  const lightness = (hex: string) => {
    const hsl = { h: 0, s: 0, l: 0 }
    new THREE.Color(hex).getHSL(hsl)
    return hsl.l
  }
  return [colors.secondary, colors.accent, colors.primary].reduce((best, next) => (lightness(next) > lightness(best) ? next : best))
}

export function dressForHome(theme: ParkTheme, colors: TeamColors): TeamDress {
  const bright = vivid(brightest(colors), 0.55, 0.72)
  const seats = vivid(colors.primary, 0.4, 0.55)
  const padding = vivid(colors.primary, 0.32, 0.48)
  const wall = vivid(colors.primary, 0.28, 0.42)
  const wood = theme.fence === 'planks'
  return {
    theme: {
      ...theme,
      fenceColor: wood ? blend(theme.fenceColor, padding, 0.75) : padding,
      standsColor: wood ? blend(theme.standsColor, seats, 0.7) : seats,
      wallColor: wood ? blend(theme.wallColor, wall, 0.75) : wall,
    },
    fenceTop: bright,
    signPaint: wood ? '#f7f3ea' : bright,
    scoreboardTitle: bright,
  }
}
