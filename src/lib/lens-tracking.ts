import type { Point } from '@/lib/lens-geometry'

const visionVersion = '0.10.14'
const visionModuleUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}/vision_bundle.mjs`
const visionWasmUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}/wasm`
const faceModelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const hairModelUrl = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite'

type TrackingSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
type MaskImage = { width: number; height: number; getAsFloat32Array(): Float32Array }
type FaceLandmarker = { detectForVideo(source: TrackingSource, timestamp: number): { faceLandmarks: Point[][] }; close(): void }
type ImageSegmenter = { segmentForVideo(source: TrackingSource, timestamp: number, callback: (result: { confidenceMasks?: MaskImage[] }) => void): void; close(): void }
type VisionModule = {
  FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }
  FaceLandmarker: { createFromOptions(fileset: unknown, options: object): Promise<FaceLandmarker> }
  ImageSegmenter: { createFromOptions(fileset: unknown, options: object): Promise<ImageSegmenter> }
}

export type HairMask = { data: Uint8Array; width: number; height: number }

let visionPromise: Promise<{ vision: VisionModule; fileset: unknown }> | null = null

function loadVision() {
  visionPromise ??= (async () => {
    const vision = await import(/* @vite-ignore */ visionModuleUrl) as VisionModule
    const fileset = await vision.FilesetResolver.forVisionTasks(visionWasmUrl)
    return { vision, fileset }
  })().catch(error => { visionPromise = null; throw error })
  return visionPromise
}

async function withGpuFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>) {
  try { return await create('GPU') } catch { return create('CPU') }
}

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null
  private segmenter: ImageSegmenter | null = null
  private segmenterLoading: Promise<void> | null = null
  private lastTimestamp = 0
  private smoothed: Point[] | null = null

  async load() {
    const { vision, fileset } = await loadVision()
    this.landmarker = await withGpuFallback(delegate => vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: faceModelUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
    }))
  }

  loadHair() {
    this.segmenterLoading ??= (async () => {
      const { vision, fileset } = await loadVision()
      this.segmenter = await withGpuFallback(delegate => vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: hairModelUrl, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      }))
    })().catch(error => { this.segmenterLoading = null; throw error })
    return this.segmenterLoading
  }

  get ready() {
    return Boolean(this.landmarker)
  }

  get hairReady() {
    return Boolean(this.segmenter)
  }

  private nextTimestamp() {
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, performance.now())
    return this.lastTimestamp
  }

  resetSmoothing() {
    this.smoothed = null
  }

  detect(source: TrackingSource, width: number, height: number, smoothing = 0.45): Point[] | null {
    if (!this.landmarker) return null
    const face = this.landmarker.detectForVideo(source, this.nextTimestamp()).faceLandmarks[0]
    if (!face) { this.smoothed = null; return null }
    const points = face.map(point => ({ x: point.x * width, y: point.y * height }))
    const previous = this.smoothed
    if (previous && previous.length === points.length) {
      const jump = Math.hypot(points[1].x - previous[1].x, points[1].y - previous[1].y)
      const keep = jump > width * 0.08 ? 0 : smoothing
      for (let index = 0; index < points.length; index++) {
        points[index] = { x: previous[index].x * keep + points[index].x * (1 - keep), y: previous[index].y * keep + points[index].y * (1 - keep) }
      }
    }
    this.smoothed = points
    return points
  }

  segmentHair(source: TrackingSource): HairMask | null {
    if (!this.segmenter) return null
    let mask: HairMask | null = null
    this.segmenter.segmentForVideo(source, this.nextTimestamp(), result => {
      const hair = result.confidenceMasks?.[1] ?? result.confidenceMasks?.[0]
      if (!hair) return
      const values = hair.getAsFloat32Array()
      const data = new Uint8Array(values.length)
      for (let index = 0; index < values.length; index++) data[index] = Math.min(255, Math.max(0, (values[index] - 0.2) * 1.6 * 255))
      mask = { data, width: hair.width, height: hair.height }
    })
    return mask
  }

  close() {
    this.landmarker?.close()
    this.segmenter?.close()
    this.landmarker = null
    this.segmenter = null
  }
}
