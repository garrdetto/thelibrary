import { SHIMMER_CELLS, buildAtlasCanvas, buildBackdropCanvas, buildMipChain, ensureDisplayFont } from './atlas'
import { PARTICLE_RENDER_WGSL, PARTICLE_WGSL, REEL_WGSL, SPRITE_WGSL } from './shaders'
import { SPRITE_FLOATS, type SpriteBatch } from './spriteBatch'

export const MAX_WINDOWS = 16
export const MAX_PARTICLES = 4096
export const PARTICLE_FLOATS = 16
const WINDOW_BYTES = 96
const GLOBALS_BYTES = 48

export class WebGPUUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebGPUUnavailableError'
  }
}

export interface ReelWindowData {
  x: number
  y: number
  w: number
  h: number
  rows: number
  curve: number
  frac: number
  blur: number
  tint: readonly [number, number, number]
  dimMask: number
  respinStyle: boolean
  slots: Uint32Array
  slotOffset: number
}

export interface ParticleSpawn {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  cell: number
  additive: boolean
  color: readonly [number, number, number, number]
  rotation: number
  spin: number
  gravity: number
  drag: number
}

export interface RenderOptions {
  motionBlur: boolean
  barrel: boolean
  shimmer: boolean
}

export interface FrameData {
  time: number
  dt: number
  back: SpriteBatch
  under: SpriteBatch
  windows: readonly ReelWindowData[]
  over: SpriteBatch
  top: SpriteBatch
  spawns: readonly ParticleSpawn[]
  glitch: number
}

export interface RendererInfo {
  adapter: string
  format: GPUTextureFormat
}

export class WebGPURenderer {
  readonly atlasCanvas: HTMLCanvasElement
  private readonly globals = new ArrayBuffer(GLOBALS_BYTES)
  private readonly globalsF = new Float32Array(this.globals)
  private readonly globalsU = new Uint32Array(this.globals)
  private readonly windowData = new ArrayBuffer(WINDOW_BYTES * MAX_WINDOWS)
  private readonly windowF = new Float32Array(this.windowData)
  private readonly windowU = new Uint32Array(this.windowData)
  private readonly spawnScratch = new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS)
  private spriteBuffer: GPUBuffer
  private spriteCapacity = 4096
  private particleCursor = 0
  private disposed = false
  options: RenderOptions = { motionBlur: true, barrel: true, shimmer: true }

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    readonly info: RendererInfo,
    private readonly globalsBuffer: GPUBuffer,
    private readonly windowBuffer: GPUBuffer,
    private readonly particleBuffer: GPUBuffer,
    private readonly globalsGroup: GPUBindGroup,
    private readonly atlasGroup: GPUBindGroup,
    private readonly backdropGroup: GPUBindGroup,
    private readonly reelGroup: GPUBindGroup,
    private readonly particleComputeGroup: GPUBindGroup,
    private readonly particleRenderGroup: GPUBindGroup,
    private readonly spritePipeline: GPURenderPipeline,
    private readonly reelPipeline: GPURenderPipeline,
    private readonly particleComputePipeline: GPUComputePipeline,
    private readonly particleRenderPipeline: GPURenderPipeline,
    atlasCanvas: HTMLCanvasElement,
  ) {
    this.atlasCanvas = atlasCanvas
    this.spriteBuffer = this.createSpriteBuffer(this.spriteCapacity)
  }

  static async create(canvas: HTMLCanvasElement, onLost: (reason: string) => void): Promise<WebGPURenderer> {
    if (!('gpu' in navigator) || !navigator.gpu) throw new WebGPUUnavailableError('This browser does not expose WebGPU.')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new WebGPUUnavailableError('No WebGPU adapter is available on this device.')
    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu')
    if (!context) throw new WebGPUUnavailableError('The canvas could not create a WebGPU context.')
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    await ensureDisplayFont()
    const atlasCanvas = buildAtlasCanvas()
    const atlasTexture = uploadCanvasTexture(device, buildMipChain(atlasCanvas), 'sunvault-atlas')
    const backdropTexture = uploadCanvasTexture(device, buildMipChain(buildBackdropCanvas(1024), 3), 'sunvault-backdrop')

    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    const globalsBuffer = device.createBuffer({ size: GLOBALS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const windowBuffer = device.createBuffer({ size: WINDOW_BYTES * MAX_WINDOWS, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    const particleBuffer = device.createBuffer({ size: MAX_PARTICLES * PARTICLE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })

    const all = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
    const globalsLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: all, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })
    const textureLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] })
    const reelLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })
    const particleComputeLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] })
    const particleRenderLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })

    const globalsGroup = device.createBindGroup({ layout: globalsLayout, entries: [{ binding: 0, resource: { buffer: globalsBuffer } }, { binding: 1, resource: sampler }] })
    const atlasGroup = device.createBindGroup({ layout: textureLayout, entries: [{ binding: 0, resource: atlasTexture.createView() }] })
    const backdropGroup = device.createBindGroup({ layout: textureLayout, entries: [{ binding: 0, resource: backdropTexture.createView() }] })
    const reelGroup = device.createBindGroup({ layout: reelLayout, entries: [{ binding: 0, resource: atlasTexture.createView() }, { binding: 1, resource: { buffer: windowBuffer } }] })
    const particleComputeGroup = device.createBindGroup({ layout: particleComputeLayout, entries: [{ binding: 0, resource: { buffer: particleBuffer } }] })
    const particleRenderGroup = device.createBindGroup({ layout: particleRenderLayout, entries: [{ binding: 0, resource: { buffer: particleBuffer } }, { binding: 1, resource: atlasTexture.createView() }] })

    const blend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    const spriteModule = device.createShaderModule({ code: SPRITE_WGSL, label: 'sunvault-sprite' })
    const reelModule = device.createShaderModule({ code: REEL_WGSL, label: 'sunvault-reel' })
    const particleModule = device.createShaderModule({ code: PARTICLE_WGSL, label: 'sunvault-particle-sim' })
    const particleRenderModule = device.createShaderModule({ code: PARTICLE_RENDER_WGSL, label: 'sunvault-particle-draw' })

    const spritePipeline = device.createRenderPipeline({
      label: 'sunvault-sprites',
      layout: device.createPipelineLayout({ bindGroupLayouts: [globalsLayout, textureLayout] }),
      vertex: {
        module: spriteModule,
        entryPoint: 'spriteVertex',
        buffers: [{
          arrayStride: SPRITE_FLOATS * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
            { shaderLocation: 3, offset: 48, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: spriteModule, entryPoint: 'spriteFragment', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    })
    const reelPipeline = device.createRenderPipeline({
      label: 'sunvault-reels',
      layout: device.createPipelineLayout({ bindGroupLayouts: [globalsLayout, reelLayout] }),
      vertex: { module: reelModule, entryPoint: 'reelVertex' },
      fragment: { module: reelModule, entryPoint: 'reelFragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const particleComputePipeline = device.createComputePipeline({
      label: 'sunvault-particle-sim',
      layout: device.createPipelineLayout({ bindGroupLayouts: [globalsLayout, particleComputeLayout] }),
      compute: { module: particleModule, entryPoint: 'simulate' },
    })
    const particleRenderPipeline = device.createRenderPipeline({
      label: 'sunvault-particles',
      layout: device.createPipelineLayout({ bindGroupLayouts: [globalsLayout, particleRenderLayout] }),
      vertex: { module: particleRenderModule, entryPoint: 'particleVertex' },
      fragment: { module: particleRenderModule, entryPoint: 'particleFragment', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    })

    const adapterInfo = adapter.info
    const renderer = new WebGPURenderer(
      device, context, { adapter: [adapterInfo?.vendor, adapterInfo?.architecture].filter(Boolean).join(' ') || 'WebGPU', format },
      globalsBuffer, windowBuffer, particleBuffer,
      globalsGroup, atlasGroup, backdropGroup, reelGroup, particleComputeGroup, particleRenderGroup,
      spritePipeline, reelPipeline, particleComputePipeline, particleRenderPipeline,
      atlasCanvas,
    )
    void device.lost.then((info) => {
      if (!renderer.disposed) onLost(info.message || 'The graphics device was lost.')
    })
    return renderer
  }

  private createSpriteBuffer(capacity: number): GPUBuffer {
    return this.device.createBuffer({ size: capacity * SPRITE_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'sunvault-sprites' })
  }

  private uploadSprites(batches: readonly SpriteBatch[]): number[] {
    const total = batches.reduce((sum, batch) => sum + batch.count, 0)
    if (total > this.spriteCapacity) {
      this.spriteBuffer.destroy()
      while (this.spriteCapacity < total) this.spriteCapacity *= 2
      this.spriteBuffer = this.createSpriteBuffer(this.spriteCapacity)
    }
    const starts: number[] = []
    let cursor = 0
    for (const batch of batches) {
      starts.push(cursor)
      if (batch.count > 0) this.device.queue.writeBuffer(this.spriteBuffer, cursor * SPRITE_FLOATS * 4, batch.data.buffer, batch.data.byteOffset, batch.count * SPRITE_FLOATS * 4)
      cursor += batch.count
    }
    return starts
  }

  private uploadWindows(windows: readonly ReelWindowData[]): number {
    const count = Math.min(MAX_WINDOWS, windows.length)
    const floatsPer = WINDOW_BYTES / 4
    for (let index = 0; index < count; index++) {
      const w = windows[index]
      const o = index * floatsPer
      const f = this.windowF
      f[o] = w.x
      f[o + 1] = w.y
      f[o + 2] = w.w
      f[o + 3] = w.h
      f[o + 4] = w.rows
      f[o + 5] = w.curve
      f[o + 6] = w.frac
      f[o + 7] = w.blur
      f[o + 8] = w.tint[0]
      f[o + 9] = w.tint[1]
      f[o + 10] = w.tint[2]
      f[o + 11] = 1
      f[o + 12] = w.dimMask
      f[o + 13] = 0
      f[o + 14] = w.respinStyle ? 1 : 0
      f[o + 15] = 0
      for (let j = 0; j < 8; j++) this.windowU[o + 16 + j] = w.slots[w.slotOffset + j]
    }
    if (count > 0) this.device.queue.writeBuffer(this.windowBuffer, 0, this.windowData, 0, count * WINDOW_BYTES)
    return count
  }

  private uploadSpawns(spawns: readonly ParticleSpawn[]): void {
    const count = Math.min(spawns.length, MAX_PARTICLES)
    if (count === 0) return
    const data = this.spawnScratch
    for (let index = 0; index < count; index++) {
      const p = spawns[index]
      const o = index * PARTICLE_FLOATS
      data[o] = p.x
      data[o + 1] = p.y
      data[o + 2] = p.vx
      data[o + 3] = p.vy
      data[o + 4] = 0
      data[o + 5] = p.life
      data[o + 6] = p.size
      data[o + 7] = p.cell + (p.additive ? 100 : 0)
      data[o + 8] = p.color[0]
      data[o + 9] = p.color[1]
      data[o + 10] = p.color[2]
      data[o + 11] = p.color[3]
      data[o + 12] = p.rotation
      data[o + 13] = p.spin
      data[o + 14] = p.gravity
      data[o + 15] = p.drag
    }
    let written = 0
    while (written < count) {
      const room = MAX_PARTICLES - this.particleCursor
      const chunk = Math.min(room, count - written)
      this.device.queue.writeBuffer(
        this.particleBuffer,
        this.particleCursor * PARTICLE_FLOATS * 4,
        data.buffer,
        written * PARTICLE_FLOATS * 4,
        chunk * PARTICLE_FLOATS * 4,
      )
      written += chunk
      this.particleCursor = (this.particleCursor + chunk) % MAX_PARTICLES
    }
  }

  render(frame: FrameData, width: number, height: number): void {
    if (this.disposed || width < 2 || height < 2) return
    const g = this.globalsF
    g[0] = width
    g[1] = height
    g[2] = frame.time
    g[3] = Math.min(frame.dt, 0.05)
    g[4] = this.options.motionBlur ? 1 : 0
    g[5] = this.options.barrel ? 1 : 0
    g[6] = this.options.shimmer ? 1 : 0
    g[7] = Math.max(0, Math.min(1, frame.glitch))
    let mask = 0
    for (const cell of SHIMMER_CELLS) mask |= 1 << cell
    this.globalsU[8] = mask >>> 0
    this.globalsU[9] = MAX_PARTICLES
    this.device.queue.writeBuffer(this.globalsBuffer, 0, this.globals)

    const batches = [frame.back, frame.under, frame.over, frame.top]
    const starts = this.uploadSprites(batches)
    const windowCount = this.uploadWindows(frame.windows)
    this.uploadSpawns(frame.spawns)

    const encoder = this.device.createCommandEncoder({ label: 'sunvault-frame' })
    const compute = encoder.beginComputePass()
    compute.setPipeline(this.particleComputePipeline)
    compute.setBindGroup(0, this.globalsGroup)
    compute.setBindGroup(1, this.particleComputeGroup)
    compute.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64))
    compute.end()

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0.03, g: 0.02, b: 0.04, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setBindGroup(0, this.globalsGroup)
    const drawSprites = (index: number, group: GPUBindGroup) => {
      const count = batches[index].count
      if (count === 0) return
      pass.setPipeline(this.spritePipeline)
      pass.setBindGroup(1, group)
      pass.setVertexBuffer(0, this.spriteBuffer)
      pass.draw(6, count, 0, starts[index])
    }
    drawSprites(0, this.backdropGroup)
    drawSprites(1, this.atlasGroup)
    if (windowCount > 0) {
      pass.setPipeline(this.reelPipeline)
      pass.setBindGroup(1, this.reelGroup)
      pass.draw(6, windowCount)
    }
    drawSprites(2, this.atlasGroup)
    pass.setPipeline(this.particleRenderPipeline)
    pass.setBindGroup(1, this.particleRenderGroup)
    pass.draw(6, MAX_PARTICLES)
    drawSprites(3, this.atlasGroup)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.spriteBuffer.destroy()
    this.device.destroy()
  }
}

function uploadCanvasTexture(device: GPUDevice, chain: readonly HTMLCanvasElement[], label: string): GPUTexture {
  const base = chain[0]
  const texture = device.createTexture({
    label,
    size: [base.width, base.height],
    mipLevelCount: chain.length,
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  chain.forEach((canvas, level) => {
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture, mipLevel: level, premultipliedAlpha: true }, [canvas.width, canvas.height])
  })
  return texture
}

