export type ParkQuality = 'low' | 'medium' | 'high'

export const QUALITY_TIERS: ParkQuality[] = ['low', 'medium', 'high']

export type QualitySettings = {
  level: 0 | 1 | 2
  maxDpr: number
  personDetail: number
  trackDetail: number
  shadowTaps: 4 | 9
  aniso: number
  fxaa: boolean
}

export const QUALITY: Record<ParkQuality, QualitySettings> = {
  low: { level: 0, maxDpr: 1, personDetail: 45, trackDetail: 0, shadowTaps: 4, aniso: 1, fxaa: false },
  medium: { level: 1, maxDpr: 1.5, personDetail: 55, trackDetail: 70, shadowTaps: 9, aniso: 2, fxaa: false },
  high: { level: 2, maxDpr: 2, personDetail: 70, trackDetail: 140, shadowTaps: 9, aniso: 8, fxaa: true },
}

export function requestedQuality(): ParkQuality | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search).get('quality')
  return q === 'low' || q === 'medium' || q === 'high' ? q : null
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i

export function rendererName(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '')
}

export function pickQuality(probeMs: number, dpr: number, name: string): { tier: ParkQuality; reason: string } {
  if (SOFTWARE.test(name)) return { tier: 'low', reason: `software renderer (${name})` }
  const pixels = (d: number) => Math.min(dpr, d) ** 2
  if (probeMs * pixels(QUALITY.high.maxDpr) < 6) return { tier: 'high', reason: `probe ${probeMs.toFixed(2)} ms at DPR ${dpr}` }
  if (probeMs * pixels(QUALITY.medium.maxDpr) < 14) return { tier: 'medium', reason: `probe ${probeMs.toFixed(2)} ms at DPR ${dpr}` }
  return { tier: 'low', reason: `probe ${probeMs.toFixed(2)} ms at DPR ${dpr}` }
}
