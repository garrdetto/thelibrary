export class Sound {
  private ctx: AudioContext | null = null
  muted = false

  private audio(): AudioContext | null {
    if (this.muted) return null
    try {
      this.ctx ??= new AudioContext()
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    } catch {
      return null
    }
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0, slide = 0) {
    const ctx = this.audio()
    if (!ctx) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + duration)
    amp.gain.setValueAtTime(gain, t)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(amp).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  private noise(duration: number, gain: number, cutoff: number) {
    const ctx = this.audio()
    if (!ctx) return
    const length = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const amp = ctx.createGain()
    amp.gain.value = gain
    source.connect(filter).connect(amp).connect(ctx.destination)
    source.start()
  }

  place() { this.tone(520, 0.07, 'triangle', 0.12); this.tone(780, 0.05, 'sine', 0.06, 0.03) }
  remove() { this.tone(240, 0.1, 'triangle', 0.12, 0, -120) }
  deny() { this.tone(160, 0.12, 'square', 0.05) }
  snap() { this.noise(0.25, 0.35, 2200); this.tone(110, 0.2, 'sawtooth', 0.08, 0, -60) }
  start() { this.tone(330, 0.12, 'triangle', 0.1); this.tone(440, 0.14, 'triangle', 0.1, 0.1) }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.1)) }
  lose() { this.tone(300, 0.35, 'sawtooth', 0.07, 0, -180); this.noise(0.6, 0.2, 600) }
}
