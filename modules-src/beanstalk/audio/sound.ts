export class StalkAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private muted = false
  private spinNode: { osc: OscillatorNode; gain: GainNode } | null = null

  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.context = new Ctor()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : 0.5
    this.master.connect(this.context.destination)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.05)
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.2, delay = 0, slideTo?: number): void {
    const ctx = this.context
    if (!ctx || !this.master) return
    const start = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(start + duration + 0.05)
  }

  private noise(duration: number, volume: number, delay = 0, filter = 1800): void {
    const ctx = this.context
    if (!ctx || !this.master) return
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = filter
    const gain = ctx.createGain()
    gain.gain.value = volume
    source.connect(band).connect(gain).connect(this.master)
    source.start(ctx.currentTime + delay)
  }

  click(): void {
    this.tone(880, 0.05, 'triangle', 0.08)
  }

  spinStart(): void {
    const ctx = this.context
    if (!ctx || !this.master) return
    this.spinStop()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 140
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = 18
    depth.gain.value = 40
    lfo.connect(depth).connect(osc.frequency)
    gain.gain.value = 0.035
    osc.connect(gain).connect(this.master)
    osc.start()
    lfo.start()
    osc.addEventListener('ended', () => lfo.stop())
    this.spinNode = { osc, gain }
  }

  spinStop(): void {
    if (!this.spinNode || !this.context) return
    const { osc, gain } = this.spinNode
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.04)
    osc.stop(this.context.currentTime + 0.2)
    this.spinNode = null
  }

  reelStop(reel: number, castle: boolean): void {
    this.tone(180 - reel * 12, 0.12, 'sine', 0.22, 0, 90)
    this.noise(0.06, 0.12, 0, 900)
    if (castle) this.tone(660 + reel * 110, 0.35, 'triangle', 0.16, 0.02)
    if (reel === 4) this.spinStop()
  }

  anticipation(): void {
    for (let index = 0; index < 8; index++) this.tone(440 + index * 60, 0.14, 'square', 0.04, index * 0.15)
  }

  plant(): void {
    this.noise(0.25, 0.25, 0, 3200)
    this.tone(1200, 0.2, 'sawtooth', 0.08, 0, 300)
  }

  grow(index: number, kind: 'climb' | 'spread'): void {
    const base = kind === 'climb' ? 330 : 440
    this.tone(base * 2 ** (Math.min(index, 12) / 12), 0.28, 'sine', 0.14, 0, base * 2 ** ((Math.min(index, 12) + 5) / 12))
    this.noise(0.18, 0.05, 0, 5000)
  }

  haywire(): void {
    for (let index = 0; index < 10; index++) {
      this.tone(80 + Math.random() * 1600, 0.06, index % 2 ? 'square' : 'sawtooth', 0.07, index * 0.07)
      this.noise(0.05, 0.1, index * 0.07 + 0.03, 400 + Math.random() * 4000)
    }
    this.tone(60, 0.9, 'sawtooth', 0.09, 0, 600)
  }

  win(multiple: number): void {
    const notes = multiple >= 12 ? [523, 659, 784, 1047, 1319] : multiple >= 2 ? [523, 659, 784] : [659, 784]
    notes.forEach((freq, index) => this.tone(freq, 0.3, 'triangle', 0.16, index * 0.09))
  }

  bigWin(): void {
    ;[392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, index) => this.tone(freq, 0.4, 'triangle', 0.18, index * 0.12))
  }

  freeTrigger(): void {
    ;[523, 784, 659, 1047, 1319, 1568].forEach((freq, index) => this.tone(freq, 0.5, 'sine', 0.18, index * 0.14))
  }
}
