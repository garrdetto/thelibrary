export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private wind: GainNode | null = null
  private voice: GainNode | null = null
  private talking: AudioBufferSourceNode | null = null
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
    this.voice = ctx.createGain()
    this.voice.gain.value = 1.5
    this.voice.connect(this.master)
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

  /** Decodes a recorded clip once the context exists (null before the first click, or for a file the browser can't read). */
  async decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    try {
      return await this.ctx.decodeAudioData(data)
    } catch {
      return null
    }
  }

  /** The audio clock, seconds (0 before the first click). */
  get time(): number {
    return this.ctx?.currentTime ?? 0
  }

  /** Wild Man talking. `WildVoice` only starts a line once the last one has ended; should two ever meet here, the earlier one is stopped rather than talked over. */
  speak(buffer: AudioBuffer): void {
    if (!this.ctx || !this.voice) return
    this.talking?.stop()
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.voice)
    src.onended = () => {
      if (this.talking === src) this.talking = null
    }
    src.start()
    this.talking = src
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

  /** A bow shot: the string slap and the line peeling off the reel. */
  twang(): void {
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190, now)
    o.frequency.exponentialRampToValueAtTime(95, now + 0.18)
    g.gain.setValueAtTime(0.18, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
    o.connect(g).connect(this.master)
    o.start(now)
    o.stop(now + 0.3)
    this.burst(0.5, 3200, 0.09, 'bandpass')
  }

  /** Wild Man hollering: a voiced glide up and down through a vowel formant, with vibrato. `big` makes it longer and wilder. Returns how long it lasts, seconds (0 when nothing sounded). */
  whoop(big = false): number {
    if (!this.ctx || !this.master) return 0
    const ctx = this.ctx
    const now = ctx.currentTime
    const len = big ? 1.5 : 0.75
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    const base = big ? 210 : 240
    o.frequency.setValueAtTime(base, now)
    o.frequency.linearRampToValueAtTime(base * 2.6, now + len * 0.35)
    o.frequency.linearRampToValueAtTime(base * (big ? 3.1 : 2.2), now + len * 0.6)
    o.frequency.linearRampToValueAtTime(base * 1.4, now + len)
    const vib = ctx.createOscillator()
    vib.frequency.value = big ? 7.5 : 6
    const vibGain = ctx.createGain()
    vibGain.gain.value = big ? 22 : 12
    vib.connect(vibGain).connect(o.frequency)
    const formant = ctx.createBiquadFilter()
    formant.type = 'bandpass'
    formant.Q.value = 3.2
    formant.frequency.setValueAtTime(750, now)
    formant.frequency.linearRampToValueAtTime(1150, now + len * 0.4)
    formant.frequency.linearRampToValueAtTime(820, now + len)
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 2600
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(big ? 0.34 : 0.26, now + 0.06)
    g.gain.setValueAtTime(big ? 0.3 : 0.22, now + len * 0.8)
    g.gain.exponentialRampToValueAtTime(0.0001, now + len)
    o.connect(formant).connect(low).connect(g).connect(this.master)
    o.start(now)
    vib.start(now)
    o.stop(now + len + 0.05)
    vib.stop(now + len + 0.05)
    return len
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
