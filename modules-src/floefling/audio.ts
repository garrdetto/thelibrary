export class Sfx {
  enabled = true
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private wind: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.55
    this.master.connect(this.ctx.destination)
    const length = this.ctx.sampleRate
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  }

  private ready(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
    if (!this.enabled || !this.ctx || !this.master || !this.noise) return null
    return { ctx: this.ctx, out: this.master, noise: this.noise }
  }

  private burst(type: BiquadFilterType, freq: number, q: number, duration: number, volume: number, delay = 0): void {
    const a = this.ready()
    if (!a) return
    const t = a.ctx.currentTime + delay
    const source = a.ctx.createBufferSource()
    source.buffer = a.noise
    const filter = a.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = a.ctx.createGain()
    gain.gain.setValueAtTime(volume, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    source.connect(filter).connect(gain).connect(a.out)
    source.start(t, Math.random() * 0.5)
    source.stop(t + duration + 0.05)
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0): void {
    const a = this.ready()
    if (!a) return
    const t = a.ctx.currentTime + delay
    const osc = a.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration)
    const gain = a.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(gain).connect(a.out)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  toss(): void { this.tone('sine', 300, 620, 0.18, 0.18); this.burst('bandpass', 900, 1.2, 0.12, 0.12) }
  swish(): void { this.burst('bandpass', 1400, 0.8, 0.22, 0.35) }
  crack(power: number, sweet: boolean): void {
    this.burst('highpass', 2200, 0.7, 0.09, 0.9 * power + 0.2)
    this.tone('triangle', sweet ? 1100 : 700, sweet ? 380 : 260, 0.16, 0.5 * power + 0.1)
    this.tone('sine', 140, 60, 0.18, 0.5 * power)
  }
  thud(strength: number): void { this.tone('sine', 120, 45, 0.22, Math.min(0.7, 0.15 + strength * 0.02)); this.burst('lowpass', 500, 0.7, 0.18, Math.min(0.6, 0.1 + strength * 0.015)) }
  skid(): void { this.burst('bandpass', 2600, 2, 0.35, 0.12) }
  boing(): void { this.tone('sine', 180, 720, 0.32, 0.45); this.tone('square', 90, 360, 0.25, 0.06) }
  splash(): void { this.burst('lowpass', 1600, 0.6, 0.55, 0.6); this.tone('sine', 520, 160, 0.3, 0.2, 0.05) }
  flop(): void { this.tone('sine', 220, 120, 0.09, 0.25); this.tone('sine', 200, 110, 0.09, 0.2, 0.16) }
  chime(): void { [784, 988, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.32, 0.22, i * 0.09)) }
  fanfare(): void { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.4, 0.22, i * 0.11)) }

  setWind(speed: number): void {
    const a = this.ready()
    if (!a) { this.stopWind(); return }
    if (!this.wind) {
      const source = a.ctx.createBufferSource()
      source.buffer = a.noise
      source.loop = true
      const filter = a.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 0.9
      const gain = a.ctx.createGain()
      gain.gain.value = 0
      source.connect(filter).connect(gain).connect(a.out)
      source.start()
      this.wind = { source, gain, filter }
    }
    const t = a.ctx.currentTime
    this.wind.gain.gain.setTargetAtTime(Math.min(0.35, speed * 0.008), t, 0.08)
    this.wind.filter.frequency.setTargetAtTime(300 + speed * 30, t, 0.08)
  }

  stopWind(): void {
    if (!this.wind) return
    try { this.wind.source.stop() } catch { /* already stopped */ }
    this.wind = null
  }
}
