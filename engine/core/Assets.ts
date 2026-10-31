/** Typed asset loader for GLTF/GLB (Draco, KTX2, meshopt; decoders emitted by the Vite build), textures, audio and JSON with a manifest, progress events and a URL-keyed cache. */
import * as THREE from 'three/webgpu'
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { AssetConfig } from '../config'
import { disposeObject } from './disposeObject'

export interface AssetTypeMap {
  gltf: GLTF
  texture: THREE.Texture
  ktx2: THREE.Texture
  audio: AudioBuffer
  json: unknown
}

export type AssetKind = keyof AssetTypeMap

export interface AssetEntry {
  kind: AssetKind
  url: string
  srgb?: boolean
}

export type AssetManifest = Readonly<Record<string, AssetEntry>>

export interface AssetProgress {
  key: string
  loaded: number
  total: number
}

export class Assets<M extends AssetManifest> extends EventTarget {
  private readonly cache = new Map<string, Promise<unknown>>()
  private readonly settled = new Map<string, unknown>()
  private readonly draco: DRACOLoader
  private readonly ktx2: KTX2Loader
  private readonly gltf: GLTFLoader
  private readonly textures = new THREE.TextureLoader()
  private audioContext: AudioContext | null = null

  constructor(
    readonly manifest: M,
    renderer: THREE.WebGPURenderer,
    config: AssetConfig,
  ) {
    super()
    this.draco = new DRACOLoader().setDecoderPath(config.dracoPath ?? DRACO_GLTF_CONFIG)
    this.ktx2 = new KTX2Loader()
    if (config.basisPath) this.ktx2.setTranscoderPath(config.basisPath)
    this.ktx2.detectSupport(renderer)
    this.gltf = new GLTFLoader().setDRACOLoader(this.draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder)
  }

  load<K extends keyof M & string>(key: K): Promise<AssetTypeMap[M[K]['kind']]> {
    const entry = this.manifest[key]
    if (!entry) return Promise.reject(new Error(`Asset ${key} is not in the manifest`))
    return this.loadUrl(entry) as Promise<AssetTypeMap[M[K]['kind']]>
  }

  get<K extends keyof M & string>(key: K): AssetTypeMap[M[K]['kind']] | undefined {
    const entry = this.manifest[key]
    return entry ? (this.settled.get(entry.url) as AssetTypeMap[M[K]['kind']] | undefined) : undefined
  }

  async loadAll(keys: readonly (keyof M & string)[] = Object.keys(this.manifest)): Promise<void> {
    let loaded = 0
    const total = keys.length
    await Promise.all(
      keys.map(async (key) => {
        await this.load(key)
        loaded++
        this.dispatchEvent(new CustomEvent<AssetProgress>('progress', { detail: { key, loaded, total } }))
      }),
    )
  }

  setAudioContext(context: AudioContext): void {
    this.audioContext = context
  }

  private loadUrl(entry: AssetEntry): Promise<unknown> {
    const cached = this.cache.get(entry.url)
    if (cached) return cached
    const pending = this.fetchEntry(entry).then((value) => {
      this.settled.set(entry.url, value)
      return value
    })
    pending.catch(() => this.cache.delete(entry.url))
    this.cache.set(entry.url, pending)
    return pending
  }

  private async fetchEntry(entry: AssetEntry): Promise<unknown> {
    switch (entry.kind) {
      case 'gltf':
        return this.gltf.loadAsync(entry.url)
      case 'texture': {
        const texture = await this.textures.loadAsync(entry.url)
        texture.colorSpace = entry.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
        return texture
      }
      case 'ktx2':
        return this.ktx2.loadAsync(entry.url)
      case 'audio': {
        const response = await fetch(entry.url)
        if (!response.ok) throw new Error(`Audio ${entry.url} failed with ${response.status}`)
        this.audioContext ??= new AudioContext()
        return this.audioContext.decodeAudioData(await response.arrayBuffer())
      }
      case 'json': {
        const response = await fetch(entry.url)
        if (!response.ok) throw new Error(`JSON ${entry.url} failed with ${response.status}`)
        return response.json()
      }
    }
  }

  dispose(): void {
    const seen = new Set<object>()
    for (const value of this.settled.values()) {
      if (value instanceof THREE.Texture) value.dispose()
      else if (value && typeof value === 'object' && 'scene' in value) disposeObject((value as GLTF).scene, seen)
    }
    this.settled.clear()
    this.cache.clear()
    this.draco.dispose()
    this.ktx2.dispose()
    void this.audioContext?.close()
  }
}
