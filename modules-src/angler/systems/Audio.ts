/** Lake sounds, all synthesised with Web Audio (no sound files): outboard engine and hull rush by speed, lapping water and wind, a loon now and then after dusk, the cast, the plop, reel drag during a fight, splashes and a chime for a good catch. Starts on the first tap or key press, as browsers require. */

type Phase = 'off' | 'cast' | 'wait' | 'bite' | 'fight' | 'land' | 'show' | 'release' | 'snap' | 'idle'

const STORE = 'tl-angler-sound'

export class LakeAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private rush: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private lap: { gain: GainNode } | null = null
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private noise: AudioBuffer | null = null
  private phase: Phase = 'off'
  private phaseT = 0
  private dragT = 0
  private loonT = 60 + Math.random() * 120
  private hidden = false
  enabled = true
  /** The player is cranking the reel, so the clicks come faster. */
  reeling = false

  constructor() {
    try { this.enabled = localStorage.getItem(STORE) !== 'off' } catch { /* default on */ }
    const start = () => { this.start(); removeEventListener('pointerdown', start); removeEventListener('keydown', start) }
    addEventListener('pointerdown', start)
    addEventListener('keydown', start)
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; this.applyVolume() })
  }

  toggle(): boolean {
    this.enabled = !this.enabled
    try { localStorage.setItem(STORE, this.enabled ? 'on' : 'off') } catch { /* not kept */ }
    if (this.enabled) this.start()
    this.applyVolume()
    return this.enabled
  }

  private applyVolume(): void {
    if (!this.ctx || !this.master) return
    const on = this.enabled && !this.hidden
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.15)
  }

  private start(): void {
    if (this.ctx) { void this.ctx.resume(); return }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    let brown = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      data[i] = i % 2 ? white * 0.5 : brown * 3.5
    }
    const loop = (filterType: BiquadFilterType, freq: number, q = 0.7) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      src.playbackRate.value = 0.7 + Math.random() * 0.6
      const filter = ctx.createBiquadFilter()
      filter.type = filterType
      filter.frequency.value = freq
      filter.Q.value = q
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(filter).connect(gain).connect(this.master!)
      src.start()
      return { filter, gain }
    }
    this.rush = loop('bandpass', 900, 0.6)
    this.lap = loop('lowpass', 380)
    this.wind = loop('bandpass', 500, 0.4)
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc2.type = 'square'
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    const gain = ctx.createGain()
    gain.gain.value = 0
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain).connect(this.master)
    osc.start()
    osc2.start()
    this.engine = { osc, osc2, gain, filter }
    this.applyVolume()
  }

  /** Per frame: speed in m/s, throttle -1..1, wind mph, 0 night to 1 day. */
  update(dt: number, speed: number, throttle: number, windMph: number, day: number, phase: Phase): void {
    const ctx = this.ctx
    if (!ctx || !this.engine || !this.enabled) return
    const t = ctx.currentTime
    const v = Math.abs(speed)
    const load = Math.min(1, Math.abs(throttle) * 0.7 + v / 28)
    const idle = v > 0.2 || Math.abs(throttle) > 0.05 ? 1 : 0.45
    const rpm = 38 + load * 95
    this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.12)
    this.engine.osc2.frequency.setTargetAtTime(rpm * 0.5 + 3, t, 0.12)
    this.engine.filter.frequency.setTargetAtTime(220 + load * 900, t, 0.15)
    this.engine.gain.gain.setTargetAtTime(0.05 * idle + load * 0.09, t, 0.2)
    this.rush!.gain.gain.setTargetAtTime(Math.min(0.35, v / 40), t, 0.25)
    this.rush!.filter.frequency.setTargetAtTime(500 + v * 45, t, 0.3)
    this.lap!.gain.gain.setTargetAtTime(0.1 + Math.sin(t * 0.7) * 0.03 + Math.sin(t * 0.23) * 0.03, t, 0.4)
    this.wind!.gain.gain.setTargetAtTime(Math.min(0.12, windMph / 160), t, 0.8)
    this.wind!.filter.frequency.setTargetAtTime(350 + windMph * 18 + Math.sin(t * 0.3) * 80, t, 0.8)

    if (phase !== this.phase) this.onPhase(phase)
    this.phaseT += dt
    if (this.phase === 'cast' && this.phaseT > 1.3 && this.phaseT - dt <= 1.3) this.plop(0.5)
    if (this.phase === 'fight') {
      this.dragT -= dt
      if (this.dragT <= 0) { this.click(); this.dragT = this.reeling ? 0.025 + Math.random() * 0.02 : 0.04 + Math.random() * 0.12 }
    }
    if (day < 0.35) {
      this.loonT -= dt
      if (this.loonT <= 0) { this.loon(); this.loonT = 90 + Math.random() * 180 }
    }
  }

  private onPhase(phase: Phase): void {
    const prev = this.phase
    this.phase = phase
    this.phaseT = 0
    if (phase === 'cast') this.swish()
    if (phase === 'bite') this.plop(0.8)
    if (phase === 'land') this.splash(0.8)
    if (phase === 'release') setTimeout(() => this.splash(0.5), 700)
    if (phase === 'snap' && prev === 'fight') this.twang()
  }

  private burst(duration: number, type: BiquadFilterType, from: number, to: number, volume: number, delay = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.master || !this.enabled) return
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(from, t)
    filter.frequency.exponentialRampToValueAtTime(to, t + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + Math.min(0.03, duration * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t, Math.random())
    src.stop(t + duration + 0.05)
  }

  private tone(freq: number, to: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.enabled) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.exponentialRampToValueAtTime(to, t + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  private swish(): void { this.burst(0.45, 'bandpass', 2400, 700, 0.18, 0.35) }
  private plop(size: number): void { this.tone(420, 110, 0.18, 0.12 * size); this.burst(0.25, 'lowpass', 1200, 300, 0.08 * size) }
  private splash(size: number): void { this.burst(0.7, 'lowpass', 2600, 400, 0.22 * size) }
  private click(): void { this.burst(0.03, 'highpass', 3800, 3000, 0.07) }
  private twang(): void { this.tone(330, 180, 0.35, 0.08, 'triangle') }

  /** A solid thump when the hook is set by hand. */
  hookSet(): void { this.tone(160, 60, 0.18, 0.16, 'triangle'); this.burst(0.15, 'lowpass', 1800, 400, 0.1) }
  /** A small plip as the jigged bait hops. */
  jig(): void { this.plop(0.35) }
  /** A splashy thrash for a jumping fish or a missed net. */
  thrash(): void { this.splash(0.6) }
  /** A quick bright two-note prompt for the net. */
  cue(): void { this.tone(880, 880, 0.12, 0.06, 'square'); this.tone(1175, 1175, 0.14, 0.06, 'square', 0.1) }
  /** The drag screaming as a fish takes line. */
  scream(): void { this.burst(0.9, 'bandpass', 4200, 2600, 0.09) }

  /** A rising two-note chime: brighter for trophies. */
  chime(big: boolean): void {
    const notes = big ? [523, 659, 784, 1047] : [587, 880]
    notes.forEach((f, i) => this.tone(f, f, big ? 0.9 : 0.6, 0.07, 'sine', i * 0.12))
  }

  private loon(): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.enabled) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const vib = ctx.createOscillator(), vibGain = ctx.createGain()
    vib.frequency.value = 6
    vibGain.gain.value = 9
    vib.connect(vibGain).connect(osc.frequency)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(560, t)
    osc.frequency.linearRampToValueAtTime(880, t + 0.6)
    osc.frequency.linearRampToValueAtTime(840, t + 1.6)
    osc.frequency.linearRampToValueAtTime(990, t + 2.0)
    osc.frequency.linearRampToValueAtTime(720, t + 2.9)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.035, t + 0.3)
    gain.gain.setValueAtTime(0.035, t + 2.4)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.1)
    const echo = ctx.createDelay(1)
    echo.delayTime.value = 0.42
    const echoGain = ctx.createGain()
    echoGain.gain.value = 0.35
    osc.connect(gain).connect(this.master)
    gain.connect(echo).connect(echoGain).connect(this.master)
    osc.start(t)
    vib.start(t)
    osc.stop(t + 3.2)
    vib.stop(t + 3.2)
  }
}
