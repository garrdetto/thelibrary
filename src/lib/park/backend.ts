import type { MeshBuilder, Mat4, Vec3, Lighting } from './gl'

/** A mesh uploaded to a backend. The renderer only passes these back to the backend that made them. */
export type MeshHandle = object

export type DrawOptions = { tint?: Vec3; slots?: Vec3[]; alpha?: number; emissive?: number; unlit?: boolean; highlight?: [number, number, number, number]; wave?: number; noCull?: boolean; noDepthWrite?: boolean; ground?: number; specular?: number }
export type InstancedDrawOptions = { emissive?: number; alpha?: number; specular?: number; wind?: number }
export type BackendStats = { shadowDraws: number; mainDraws: number; shadowVerts: number; mainVerts: number; instanceBytes: number }

/**
 * Everything ParkRenderer asks of the GPU. The classic WebGL2 `Gl` and the
 * PlayCanvas backend used by Thrill Park 2 both implement it, so the park's
 * models, animation, culling, previews and picking are shared.
 */
export interface RenderBackend {
  readonly shadowsAvailable: boolean
  shadowPass: boolean
  shadowBias: number
  windLevel: number
  stats: BackendStats
  setLevel(level: number): void
  probe(): number
  rendererName(): string
  upload(builder: MeshBuilder, previous?: MeshHandle | null, instanced?: boolean): MeshHandle | null
  setInstances(mesh: MeshHandle | null, data: Float32Array, count: number): void
  free(mesh: MeshHandle): void
  beginShadow(lightViewProj: Mat4, texelWorld: number, time?: number): boolean
  endShadow(): void
  beginPost(width: number, height: number): boolean
  freePost(): void
  endPost(): void
  begin(width: number, height: number, view: Mat4, proj: Mat4, cam: Vec3, light: Lighting, time: number, shadowStrength?: number): void
  draw(mesh: MeshHandle | null, model?: Mat4, opts?: DrawOptions): void
  drawInstanced(mesh: MeshHandle | null, opts?: InstancedDrawOptions): void
  /** Lamp-post positions (InstanceList layout), for backends that light them at night. */
  lamps?(data: Float32Array, count: number, night: boolean): void
  dispose(): void
}

export type BackendFactory = (canvas: HTMLCanvasElement) => RenderBackend
