/**
 * Picks the renderer: Babylon's WebGPU engine whenever the browser hands out an adapter, the WebGL2 engine only when it has none or
 * `?gpu=webgl` asks for it. Every custom shader in the module is written in WGSL for the WebGPU engine, so nothing is transpiled from
 * GLSL there. If the WebGPU engine cannot start, loses its device or never draws a frame, the page reloads itself once onto WebGL2.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import '@babylonjs/core/Engines/Extensions/engine.alpha'
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/Extensions/engine.query'
import '@babylonjs/core/Engines/Extensions/engine.rawTexture'
import '@babylonjs/core/Engines/Extensions/engine.readTexture'
import '@babylonjs/core/Engines/Extensions/engine.renderTarget'
import '@babylonjs/core/Engines/Extensions/engine.renderTargetTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.alpha'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.query'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.rawTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.readTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTarget'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTargetTexture'
import { wantsWebGpu, webGlAddress } from './Backend'
import type { Backend } from './Backend'

export interface EngineBoot {
  engine: AbstractEngine
  backend: Backend
  /** Call when the render loop starts: a WebGPU engine that has drawn nothing a few seconds later is replaced by WebGL2. */
  watchFirstFrame(): void
}

const FIRST_FRAME_MS = 8000

type GpuPreference = 'high-performance' | undefined

async function webGpuPreference(): Promise<GpuPreference | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<unknown> } }).gpu
  if (!gpu || !(await WebGPUEngine.IsSupportedAsync)) return null
  try {
    if (await gpu.requestAdapter({ powerPreference: 'high-performance' })) return 'high-performance'
    if (await gpu.requestAdapter()) return undefined
  } catch {
    return null
  }
  return null
}

/** A canvas that has given out a WebGPU context cannot give a WebGL one, so the switch is a reload of the page. */
function restartOnWebGl(reason: string): Promise<never> {
  console.warn(`${reason}, reloading on WebGL2`)
  location.replace(webGlAddress(location.href))
  return new Promise<never>(() => {})
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineBoot> {
  const preference = wantsWebGpu(location.search) ? await webGpuPreference() : null
  if (preference !== null) {
    let engine: WebGPUEngine
    try {
      engine = new WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false, stencil: false, setMaximumLimits: true, enableAllFeatures: false, doNotHandleContextLost: true, ...(preference ? { powerPreference: preference } : {}) })
      await engine.initAsync()
    } catch (error) {
      console.warn(error)
      return restartOnWebGl('WebGPU could not start')
    }
    let drawn = false
    let replaced = false
    const replace = (reason: string) => {
      if (replaced) return
      replaced = true
      void restartOnWebGl(reason)
    }
    engine.onEndFrameObservable.addOnce(() => {
      drawn = true
    })
    engine.onContextLostObservable.add(() => replace('WebGPU device lost'))
    return {
      engine,
      backend: 'webgpu',
      watchFirstFrame: () => {
        setTimeout(() => {
          if (!drawn) replace('WebGPU drew no frames')
        }, FIRST_FRAME_MS)
      },
    }
  }
  const engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', antialias: false, adaptToDeviceRatio: false }, false)
  if (engine.webGLVersion < 2) throw new Error('WebGL2 is required')
  return { engine, backend: 'webgl2', watchFirstFrame: () => {} }
}
