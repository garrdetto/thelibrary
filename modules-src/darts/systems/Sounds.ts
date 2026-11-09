/** Synthesised sound (Web Audio, no files): a soft whoosh on release, a thunk into sisal (or a clatter for a miss), a low buzz for a bust and a short rising chord for a 180 or a checkout. Silent until the first throw unlocks audio. */

export interface Sounds {
  unlock(): void
  whoosh(): void
  thunk(miss: boolean): void
  bust(): void
  cheer(): void
  dispose(): void
}

export function createSounds(): Sounds {
  let ctx: AudioContext | null = null
  let noise: AudioBuffer | null = null
  const muted = () => !ctx || ctx.state !== 'running'

  const noiseBuffer = (context: AudioContext) => {
    if (noise) return noise
    const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 12345
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      data[i] = (seed / 4294967296) * 2 - 1
    }
    noise = buffer
    return buffer
  }

  const burst = (duration: number, frequency: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') => {
    if (muted() || !ctx) return
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    const amp = ctx.createGain()
    const now = ctx.currentTime
    amp.gain.setValueAtTime(0.0001, now)
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.008)
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(filter).connect(amp).connect(ctx.destination)
    source.start(now)
    source.stop(now + duration + 0.05)
  }

  const tone = (frequency: number, start: number, duration: number, gain: number, type: OscillatorType = 'triangle') => {
    if (muted() || !ctx) return
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = frequency
    const amp = ctx.createGain()
    const at = ctx.currentTime + start
    amp.gain.setValueAtTime(0.0001, at)
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.02)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(amp).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + duration + 0.05)
  }

  return {
    unlock() {
      try {
        ctx ??= new AudioContext()
        if (ctx.state === 'suspended') void ctx.resume()
      } catch {
        ctx = null
      }
    },
    whoosh() {
      burst(0.22, 1400, 0.7, 0.05)
    },
    thunk(miss) {
      if (miss) {
        burst(0.12, 3200, 3, 0.08)
        tone(1900, 0.02, 0.08, 0.02, 'square')
        return
      }
      burst(0.09, 420, 1.2, 0.35, 'lowpass')
      tone(150, 0, 0.09, 0.12, 'sine')
    },
    bust() {
      tone(110, 0, 0.35, 0.08, 'sawtooth')
      tone(98, 0.05, 0.35, 0.06, 'sawtooth')
    },
    cheer() {
      ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => tone(frequency, i * 0.07, 0.5, 0.05))
    },
    dispose() {
      void ctx?.close().catch(() => undefined)
      ctx = null
    },
  }
}
