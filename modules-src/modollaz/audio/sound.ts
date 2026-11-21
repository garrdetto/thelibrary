export class DollazAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private muted = false

  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.context = new Ctor()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : 0.45
    this.master.connect(this.context.destination)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.context.currentTime, 0.05)
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
    this.tone(900, 0.05, 'triangle', 0.08)
  }

  spinStart(): void {
    this.noise(0.35, 0.08, 0, 900)
    this.tone(180, 0.3, 'sawtooth', 0.04, 0, 90)
  }

  reelStop(reel: number, special: boolean): void {
    this.noise(0.07, 0.18, 0, 500 + reel * 120)
    this.tone(120 + reel * 14, 0.09, 'square', 0.05)
    if (special) this.tone(1320 + reel * 110, 0.22, 'triangle', 0.09)
  }

  anticipation(): void {
    for (let index = 0; index < 8; index++) this.tone(440 + index * 70, 0.12, 'triangle', 0.05, index * 0.13)
  }

  win(multiple: number): void {
    const notes = multiple >= 5 ? [523, 659, 784, 1047] : [659, 784]
    notes.forEach((freq, index) => this.tone(freq, 0.25, 'triangle', 0.12, index * 0.08))
  }

  pop(kind: 'coin' | 'bill' | 'grow'): void {
    if (kind === 'grow') {
      ;[392, 523, 659, 784, 1047].forEach((freq, index) => this.tone(freq, 0.3, 'square', 0.07, index * 0.06))
      return
    }
    this.tone(kind === 'coin' ? 1568 : 1175, 0.16, 'triangle', 0.12)
    this.tone(kind === 'coin' ? 2093 : 1568, 0.2, 'sine', 0.08, 0.05)
  }

  tick(): void {
    this.tone(1800 + Math.random() * 400, 0.04, 'square', 0.025)
  }

  feature(): void {
    ;[523, 659, 784, 1047, 1319].forEach((freq, index) => this.tone(freq, 0.4, 'triangle', 0.12, index * 0.1))
    this.noise(0.6, 0.06, 0.1, 3200)
  }

  bigWin(huge: boolean): void {
    const notes = huge ? [392, 523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047]
    notes.forEach((freq, index) => this.tone(freq, 0.5, 'sawtooth', 0.06, index * 0.11))
    notes.forEach((freq, index) => this.tone(freq * 2, 0.4, 'triangle', 0.05, index * 0.11 + 0.05))
  }

  land(): void {
    ;[1047, 1319, 1568, 2093].forEach((freq) => this.tone(freq, 0.6, 'triangle', 0.08))
    this.noise(0.4, 0.1, 0, 4000)
  }
}
