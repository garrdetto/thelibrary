/** Shot tracer model factory: a line with a fixed-capacity buffer that shows the ball's path so far. */
import * as THREE from 'three/webgpu'

export interface TracerSpec {
  color: string
  maxPoints: number
  opacity: number
}

export interface TracerModel {
  line: THREE.Line
  /** Copies points from a flat xyz array (every stride-th sample, up to count samples) into the line. */
  show(samples: readonly number[], count: number, stride: number): void
  clear(): void
}

export function createTracer(spec: TracerSpec): TracerModel {
  const positions = new Float32Array(spec.maxPoints * 3)
  const attribute = new THREE.BufferAttribute(positions, 3)
  attribute.setUsage(THREE.DynamicDrawUsage)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', attribute)
  geometry.setDrawRange(0, 0)
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(spec.color), transparent: true, opacity: spec.opacity })
  const line = new THREE.Line(geometry, material)
  line.name = 'tracer'
  line.frustumCulled = false
  return {
    line,
    show(samples, count, stride) {
      const step = Math.max(1, stride)
      let written = 0
      for (let index = 0; index < count && written < spec.maxPoints; index += step) {
        positions[written * 3] = samples[index * 3]
        positions[written * 3 + 1] = samples[index * 3 + 1]
        positions[written * 3 + 2] = samples[index * 3 + 2]
        written++
      }
      if (count > 0 && written < spec.maxPoints) {
        const last = (count - 1) * 3
        positions.set([samples[last], samples[last + 1], samples[last + 2]], written * 3)
        written++
      }
      attribute.needsUpdate = true
      geometry.setDrawRange(0, written)
    },
    clear() {
      geometry.setDrawRange(0, 0)
    },
  }
}
