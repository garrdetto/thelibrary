import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import '@babylonjs/core/Engines/Extensions/engine.alpha'
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.alpha'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture'

export type Backend = 'webgpu' | 'webgl2'

export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: Backend }> {
  const forceGl = new URLSearchParams(location.search).get('renderer') === 'webgl'
  if (!forceGl && 'gpu' in navigator) {
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, powerPreference: 'high-performance' })
        await engine.initAsync()
        return { engine, backend: 'webgpu' }
      }
    } catch (error) {
      console.warn('WebGPU unavailable, using WebGL2', error)
    }
  }
  const engine = new Engine(canvas, true, { powerPreference: 'high-performance', preserveDrawingBuffer: true, stencil: true }, true)
  return { engine, backend: 'webgl2' }
}
