/** Which Babylon engine draws the module, and the `?gpu=` switch that overrides the automatic choice. Renderer-free. */
export type Backend = 'webgpu' | 'webgl2'

/** WebGPU is used whenever the browser offers an adapter; `?gpu=webgl` pins WebGL2. */
export const WEBGPU_FIRST = true
export const BACKEND_PARAM = 'gpu'

/** True when the page should try the WebGPU engine before WebGL2. */
export function wantsWebGpu(search: string, webGpuFirst = WEBGPU_FIRST): boolean {
  const value = new URLSearchParams(search).get(BACKEND_PARAM)
  if (value === 'webgl' || value === 'webgl2') return false
  if (value === 'webgpu') return true
  return webGpuFirst
}

/** The same address with `?gpu=webgl`, used to restart on WebGL2 after the WebGPU device fails. */
export function webGlAddress(href: string): string {
  const url = new URL(href)
  url.searchParams.set(BACKEND_PARAM, 'webgl')
  return url.href
}
