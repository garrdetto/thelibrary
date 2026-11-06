import type { BackendFactory } from '../park/backend'
import { BabylonBackend } from './babylonBackend'

/** Thrill Park 2's renderer backend: Babylon.js on WebGPU (WebGL2 as the fallback), behind the park renderer's backend interface. */
export const createBackend: BackendFactory = canvas => new BabylonBackend(canvas)
