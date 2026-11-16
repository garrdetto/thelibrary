type Wave = OscillatorType

export class SlotAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: DynamicsCompressorNode | null = null
  private noise: AudioBuffer | null = null
  private spinNodes: { source: AudioBufferSourceNode; gain: GainNode; tick: number } | null = null
  private anticipation: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null
  private muted = false
  private volume = 0.7

  get isMuted(): boolean {
    return this.muted
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const bus = ctx.createDynamicsCompressor()
      bus.threshold.value = -14
      bus.ratio.value = 4
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : this.volume
      bus.connect(master)
      master.connect(ctx.destination)
      const length = ctx.sampleRate * 2
      const noise = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1
      this.ctx = ctx
      this.bus = bus
      this.master = master
      this.noise = noise
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02)
  }

  private ready(): { ctx: AudioContext; out: AudioNode; noise: AudioBuffer } | null {
    if (!this.ctx || !this.bus || !this.noise || this.muted) return null
    return { ctx: this.ctx, out: this.bus, noise: this.noise }
  }

  private tone(freq: number, start: number, duration: number, options: { wave?: Wave; gain?: number; attack?: number; glideTo?: number; detune?: number } = {}): void {
    const env = this.ready()
    if (!env) return
    const { ctx, out } = env
    const t0 = ctx.currentTime + start
    const osc = ctx.createOscillator()
    osc.type = options.wave ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (options.glideTo) osc.frequency.exponentialRampToValueAtTime(options.glideTo, t0 + duration)
    if (options.detune) osc.detune.value = options.detune
    const gain = ctx.createGain()
    const peak = options.gain ?? 0.2
    const attack = options.attack ?? 0.005
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    osc.connect(gain)
    gain.connect(out)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
  }

  private burst(start: number, duration: number, options: { type?: BiquadFilterType; freq?: number; q?: number; gain?: number; sweepTo?: number } = {}): void {
    const env = this.ready()
    if (!env) return
    const { ctx, out, noise } = env
    const t0 = ctx.currentTime + start
    const source = ctx.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = options.type ?? 'bandpass'
    filter.frequency.setValueAtTime(options.freq ?? 1200, t0)
    if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, t0 + duration)
    filter.Q.value = options.q ?? 1
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(options.gain ?? 0.2, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    source.start(t0, Math.random())
    source.stop(t0 + duration + 0.05)
  }

  click(): void {
    this.tone(1800, 0, 0.04, { wave: 'square', gain: 0.04 })
  }

  spinStart(turbo: boolean): void {
    this.spinStop()
    const env = this.ready()
    if (!env) return
    const { ctx, out, noise } = env
    const source = ctx.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = turbo ? 900 : 650
    filter.Q.value = 0.8
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.15)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    source.start()
    const tick = window.setInterval(() => this.tone(2400 + Math.random() * 300, 0, 0.025, { wave: 'triangle', gain: 0.025 }), turbo ? 45 : 70)
    this.spinNodes = { source, gain, tick }
  }

  spinStop(): void {
    const nodes = this.spinNodes
    if (!nodes) return
    this.spinNodes = null
    window.clearInterval(nodes.tick)
    if (this.ctx) {
      nodes.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05)
      nodes.source.stop(this.ctx.currentTime + 0.3)
    }
  }

  reelStop(reel: number): void {
    this.tone(130 - reel * 6, 0, 0.2, { wave: 'sine', gain: 0.35, glideTo: 42 })
    this.burst(0, 0.06, { type: 'lowpass', freq: 2500, gain: 0.15 })
    this.tone(900 + reel * 40, 0, 0.05, { wave: 'triangle', gain: 0.05 })
  }

  coinLand(index = 0): void {
    const base = 1318.5 * Math.pow(2, Math.min(index, 12) / 12)
    this.tone(base, 0, 0.35, { wave: 'sine', gain: 0.12 })
    this.tone(base * 2.76, 0, 0.18, { wave: 'sine', gain: 0.05 })
    this.tone(base * 1.5, 0.05, 0.3, { wave: 'triangle', gain: 0.05 })
  }

  scatterLand(count: number): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    for (let k = 0; k < Math.min(count, 4); k++) this.tone(notes[k], k * 0.06, 0.5, { wave: 'triangle', gain: 0.1 })
    this.burst(0, 0.5, { type: 'highpass', freq: 5000, gain: 0.05 })
  }

  roar(): void {
    const env = this.ready()
    if (!env) return
    const { ctx, out } = env
    const t0 = ctx.currentTime
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let index = 0; index < curve.length; index++) {
      const x = (index / curve.length) * 2 - 1
      curve[index] = Math.tanh(x * 4)
    }
    shaper.curve = curve
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(260, t0)
    filter.frequency.exponentialRampToValueAtTime(1400, t0 + 0.25)
    filter.frequency.exponentialRampToValueAtTime(180, t0 + 1.3)
    filter.Q.value = 6
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.12)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4)
    for (const [freq, detune] of [[62, 0], [64, 12], [93, -8]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(freq, t0)
      osc.frequency.linearRampToValueAtTime(freq * 0.78, t0 + 1.3)
      osc.detune.value = detune
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 24
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = freq * 0.08
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      osc.connect(shaper)
      osc.start(t0)
      lfo.start(t0)
      osc.stop(t0 + 1.5)
      lfo.stop(t0 + 1.5)
    }
    shaper.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    this.burst(0, 1.2, { type: 'bandpass', freq: 500, sweepTo: 220, q: 1.5, gain: 0.12 })
  }

  lineWin(multiple: number): void {
    const notes = multiple >= 5 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : multiple >= 1 ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99, 1046.5]
    notes.forEach((note, k) => {
      this.tone(note, k * 0.07, 0.4, { wave: 'triangle', gain: 0.09 })
      this.tone(note * 2, k * 0.07, 0.2, { wave: 'sine', gain: 0.03 })
    })
  }

  collectTick(index: number): void {
    this.coinLand(index)
    this.burst(0, 0.08, { type: 'highpass', freq: 6000, gain: 0.04 })
  }

  zoneGrow(): void {
    this.tone(220, 0, 0.6, { wave: 'sawtooth', gain: 0.06, glideTo: 660 })
    this.tone(330, 0.1, 0.6, { wave: 'triangle', gain: 0.08, glideTo: 990 })
    this.burst(0, 0.6, { type: 'bandpass', freq: 400, sweepTo: 3000, gain: 0.08 })
  }

  anticipationStart(seconds: number): void {
    this.anticipationStop()
    const env = this.ready()
    if (!env) return
    const { ctx, out } = env
    const t0 = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.2)
    gain.gain.linearRampToValueAtTime(0.14, t0 + seconds)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(196, t0)
    osc.frequency.exponentialRampToValueAtTime(784, t0 + seconds)
    const osc2 = ctx.createOscillator()
    osc2.type = 'square'
    osc2.frequency.setValueAtTime(198, t0)
    osc2.frequency.exponentialRampToValueAtTime(792, t0 + seconds)
    const tremolo = ctx.createOscillator()
    tremolo.frequency.setValueAtTime(6, t0)
    tremolo.frequency.linearRampToValueAtTime(18, t0 + seconds)
    const tremoloGain = ctx.createGain()
    tremoloGain.gain.value = 0.04
    tremolo.connect(tremoloGain)
    tremoloGain.connect(gain.gain)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1800
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    osc.start(t0)
    osc2.start(t0)
    tremolo.start(t0)
    tremolo.stop(t0 + seconds + 1)
    this.anticipation = { osc, osc2, gain }
  }

  anticipationStop(): void {
    const nodes = this.anticipation
    if (!nodes || !this.ctx) return
    this.anticipation = null
    const t = this.ctx.currentTime
    nodes.gain.gain.cancelScheduledValues(t)
    nodes.gain.gain.setTargetAtTime(0.0001, t, 0.04)
    nodes.osc.stop(t + 0.3)
    nodes.osc2.stop(t + 0.3)
  }

  respinTrigger(): void {
    const chord = [261.63, 329.63, 392, 523.25]
    for (let rep = 0; rep < 3; rep++) chord.forEach((note, k) => this.tone(note * (1 + rep * 0.5), rep * 0.18 + k * 0.03, 0.5, { wave: 'sawtooth', gain: 0.04 }))
    this.tone(65.4, 0, 1.1, { wave: 'sine', gain: 0.3 })
  }

  respinReset(): void {
    this.tone(880, 0, 0.12, { wave: 'square', gain: 0.05 })
    this.tone(1174.7, 0.08, 0.2, { wave: 'square', gain: 0.05 })
  }

  freeTrigger(): void {
    const notes = [392, 493.88, 587.33, 783.99, 987.77, 1174.7]
    notes.forEach((note, k) => this.tone(note, k * 0.08, 0.7, { wave: 'triangle', gain: 0.08 }))
    this.burst(0, 1.2, { type: 'highpass', freq: 4000, gain: 0.05 })
  }

  jackpot(tier: 'mini' | 'minor' | 'major' | 'grand'): void {
    const levels = { mini: 1, minor: 2, major: 3, grand: 4 }
    const reps = levels[tier]
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5]
    for (let rep = 0; rep < reps; rep++) {
      fanfare.forEach((note, k) => {
        const at = rep * 0.9 + k * 0.11
        this.tone(note, at, k === fanfare.length - 1 ? 0.8 : 0.25, { wave: 'sawtooth', gain: 0.05 })
        this.tone(note / 2, at, 0.25, { wave: 'square', gain: 0.03 })
      })
      this.tone(130.8, rep * 0.9, 0.9, { wave: 'sine', gain: 0.25 })
    }
  }

  bigWin(level: number): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
    for (let rep = 0; rep < level + 1; rep++) notes.forEach((note, k) => this.tone(note, rep * 0.55 + k * 0.06, 0.5, { wave: 'triangle', gain: 0.07 }))
    this.tone(98, 0, 1.4, { wave: 'sine', gain: 0.25 })
  }

  tally(): void {
    this.tone(1760 + Math.random() * 200, 0, 0.05, { wave: 'square', gain: 0.025 })
  }

  dispose(): void {
    this.spinStop()
    this.anticipationStop()
    void this.ctx?.close()
    this.ctx = null
  }
}
