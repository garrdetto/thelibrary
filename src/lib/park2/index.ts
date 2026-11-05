import type { BackendFactory } from '../park/backend'
import { PcBackend } from './pcBackend'

/** Thrill Park 2's renderer backend: PlayCanvas, behind the park renderer's backend interface. */
export const createBackend: BackendFactory = canvas => new PcBackend(canvas)
