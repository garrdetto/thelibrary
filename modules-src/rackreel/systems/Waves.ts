const SINE_SAMPLES = 1024
export const SINE_BUFFER = (() => {
  const buf = new Float32Array(SINE_SAMPLES + 1)
  for (let i = 0; i <= SINE_SAMPLES; i++) buf[i] = Math.sin((i / SINE_SAMPLES) * Math.PI * 2)
  return buf
})()

export function bufferedSine(phase: number): number {
  const t = (phase / (Math.PI * 2)) % 1
  const u = (t < 0 ? t + 1 : t) * SINE_SAMPLES
  const i = Math.floor(u)
  const f = u - i
  return SINE_BUFFER[i] + (SINE_BUFFER[i + 1] - SINE_BUFFER[i]) * f
}
