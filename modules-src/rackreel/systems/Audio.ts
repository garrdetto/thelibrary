export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private wind: GainNode | null = null
  muted = false

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
    } catch {
      return
    }
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.55
    this.master.connect(ctx.destination)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 40
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 380
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master)
    this.engineOsc.start()
    const windSrc = ctx.createBufferSource()
    windSrc.buffer = this.noise
    windSrc.loop = true
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 420
    windFilter.Q.value = 0.4
    this.wind = ctx.createGain()
    this.wind.gain.value = 0.035
    windSrc.connect(windFilter).connect(this.wind).connect(this.master)
    windSrc.start()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 0.55
  }

  engine(active: boolean, speed01: number, boat: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return
    const now = this.ctx.currentTime
    this.engineOsc.frequency.setTargetAtTime((boat ? 55 : 42) + speed01 * (boat ? 90 : 110), now, 0.1)
    this.engineGain.gain.setTargetAtTime(active ? 0.06 + speed01 * 0.07 : 0, now, 0.15)
  }

  private burst(duration: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', decay = 4): void {
    if (!this.ctx || !this.noise || !this.master) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    const g = ctx.createGain()
    const now = ctx.currentTime
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    src.connect(filter).connect(g).connect(this.master)
    src.start(now, Math.random(), duration * decay)
    src.stop(now + duration)
  }

  shot(): void {
    this.burst(0.08, 4000, 1.2, 'lowpass')
    this.burst(1.6, 300, 0.7, 'lowpass')
  }

  splash(big = false): void {
    this.burst(big ? 0.7 : 0.35, big ? 900 : 1600, big ? 0.5 : 0.3, 'bandpass')
  }

  click(): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'square'
    o.frequency.value = 1800 + Math.random() * 300
    const now = this.ctx.currentTime
    g.gain.setValueAtTime(0.04, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
    o.connect(g).connect(this.master)
    o.start(now)
    o.stop(now + 0.04)
  }

  whoosh(): void {
    this.burst(0.35, 2500, 0.25, 'highpass')
  }

  chime(): void {
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    ;[523, 659, 784, 1046].forEach((f, i) => {
      const o = this.ctx!.createOscillator()
      const g = this.ctx!.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, now + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.09, now + i * 0.09 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.6)
      o.connect(g).connect(this.master!)
      o.start(now + i * 0.09)
      o.stop(now + i * 0.09 + 0.7)
    })
  }
}
