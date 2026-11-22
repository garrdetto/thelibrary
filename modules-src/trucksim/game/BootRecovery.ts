/** What the page does when `Standalone.boot` throws: retry once on WebGL2 unless already there, otherwise explain with the real error. Renderer-free. */
import { BACKEND_PARAM, webGlAddress } from '../../rackreel/core/Backend'

export interface BootFailure {
  retry: string | null
  message: string
}

export function bootFailure(href: string, error: unknown): BootFailure {
  const pinned = new URL(href).searchParams.get(BACKEND_PARAM)
  if (pinned !== 'webgl' && pinned !== 'webgl2') return { retry: webGlAddress(href), message: '' }
  const detail = error instanceof Error ? error.message : String(error)
  return {
    retry: null,
    message: `Truck Simulator could not start on this device (${detail.slice(0, 160)}). Try another browser or update your graphics drivers.`,
  }
}
