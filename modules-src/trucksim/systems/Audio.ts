/**
 * Truck Simulator sound, synthesised with Web Audio only (no files). Nothing is created until `start()`, which must be called from
 * a user gesture; it builds one AudioContext with master, engine and effects gains. The diesel is a few detuned saw and square
 * oscillators at the six-cylinder firing frequency (rpm / 60 x 3) through a low-pass filter that opens with load, plus a turbo
 * whistle, a gated jake-brake buzz, noise-based air-brake hiss, a 1 kHz backup beeper, a two-tone stock or three-tone air horn
 * and a hydraulic whine. Parameters glide with `setTargetAtTime`. `dispose()` stops and disconnects every node and closes the context.
 */

export type HornKind = 'stock' | 'air'

const CYLINDERS = 6
const TURBO_START_RPM = 1300
const SMOOTHING = 0.05
const STOCK_HORN_HZ = [415, 523] as const
const AIR_HORN_HZ = [311, 370, 466] as const

interface EngineState {
  rpm: number
  load: number
}

/** The synthesised sound of one truck; drive it every frame with `setEngine` and the other setters. */
export class TruckAudio {
  private context: AudioContext | null = null
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private master: GainNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private engineOscillators: OscillatorNode[] = []
  private engineDetunes: readonly number[] = [-9, 6, 0]
  private turboOscillator: OscillatorNode | null = null
  private turboGain: GainNode | null = null
  private jakeOscillator: OscillatorNode | null = null
  private jakeGain: GainNode | null = null
  private hissGain: GainNode | null = null
  private beeperGain: GainNode | null = null
  private hornGains: GainNode[] = []
  private hornKind: HornKind | null = null
  private hydraulicOscillator: OscillatorNode | null = null
  private hydraulicGain: GainNode | null = null
  private volume = 0.7
  private readonly engine: EngineState = { rpm: 700, load: 0 }
  private jakeOn = false
  private beeperOn = false
  private hydraulicLevel = 0

  get started(): boolean {
    return this.context !== null
  }

  /** Builds the graph on first call and resumes the context. Call from a click, tap or key press. */
  start(): void {
    if (typeof AudioContext === 'undefined') return
    if (!this.context) this.build(new AudioContext())
    void this.context?.resume()
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    this.glide(this.master?.gain, this.volume)
  }

  /** Engine speed in rpm and load from 0 (coasting) to 1 (full throttle). */
  setEngine(rpm: number, load: number): void {
    this.engine.rpm = Math.max(0, rpm)
    this.engine.load = Math.min(1, Math.max(0, load))
    if (!this.context) return
    const firing = Math.max(8, (this.engine.rpm / 60) * (CYLINDERS / 2))
    for (let index = 0; index < this.engineOscillators.length; index++) this.glide(this.engineOscillators[index].frequency, firing)
    this.glide(this.engineFilter?.frequency, 160 + this.engine.rpm * 0.25 + this.engine.load * 700)
    this.glide(this.engineGain?.gain, 0.08 + this.engine.load * 0.14)
    const turbo = this.engine.rpm > TURBO_START_RPM && this.engine.load > 0.3
    this.glide(this.turboGain?.gain, turbo ? 0.012 * this.engine.load : 0)
    this.glide(this.turboOscillator?.frequency, 2400 + Math.max(0, this.engine.rpm - TURBO_START_RPM) * 3.5)
    this.glide(this.jakeOscillator?.frequency, firing * 2)
  }

  setJakeBrake(on: boolean): void {
    this.jakeOn = on
    this.glide(this.jakeGain?.gain, on ? 0.09 : 0)
  }

  /** A short hiss of released air; `strength` from 0 to 1. */
  airBrake(strength = 1): void {
    const context = this.context
    const gain = this.hissGain
    if (!context || !gain) return
    const now = context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0.16 * Math.min(1, Math.max(0, strength)), now + 0.02)
    gain.gain.setTargetAtTime(0, now + 0.05, 0.22)
  }

  setBackupBeeper(on: boolean): void {
    this.beeperOn = on
    this.glide(this.beeperGain?.gain, on ? 0.05 : 0)
  }

  /** Sounds the horn of the given kind while held; pass null to release it. */
  setHorn(kind: HornKind | null): void {
    this.hornKind = kind
    for (let index = 0; index < this.hornGains.length; index++) {
      const stockTone = kind === 'stock' && index < STOCK_HORN_HZ.length
      const airTone = kind === 'air' && index >= STOCK_HORN_HZ.length
      const level = stockTone ? 0.07 : airTone ? 0.16 : 0
      this.glide(this.hornGains[index].gain, level, 0.015)
    }
  }

  /** Dump-bed hydraulics, from 0 (silent) to 1 (straining). */
  setHydraulic(level: number): void {
    this.hydraulicLevel = Math.min(1, Math.max(0, level))
    this.glide(this.hydraulicGain?.gain, this.hydraulicLevel * 0.05)
    this.glide(this.hydraulicOscillator?.frequency, 170 + this.hydraulicLevel * 240)
  }

  dispose(): void {
    const context = this.context
    if (!context) return
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        continue
      }
    }
    for (const node of this.nodes) node.disconnect()
    this.nodes.length = 0
    this.sources.length = 0
    this.engineOscillators = []
    this.hornGains = []
    this.master = this.engineGain = this.turboGain = this.jakeGain = this.hissGain = this.beeperGain = this.hydraulicGain = null
    this.engineFilter = null
    this.turboOscillator = this.jakeOscillator = this.hydraulicOscillator = null
    this.context = null
    void context.close()
  }

  private glide(param: AudioParam | undefined, value: number, timeConstant = SMOOTHING): void {
    if (!param || !this.context) return
    param.setTargetAtTime(value, this.context.currentTime, timeConstant)
  }

  private add<T extends AudioNode>(node: T): T {
    this.nodes.push(node)
    return node
  }

  private oscillator(context: AudioContext, type: OscillatorType, frequency: number): OscillatorNode {
    const oscillator = this.add(context.createOscillator())
    oscillator.type = type
    oscillator.frequency.value = frequency
    this.sources.push(oscillator)
    return oscillator
  }

  private gainNode(context: AudioContext, value: number): GainNode {
    const gain = this.add(context.createGain())
    gain.gain.value = value
    return gain
  }

  private build(context: AudioContext): void {
    this.context = context
    const master = (this.master = this.gainNode(context, this.volume))
    master.connect(context.destination)
    const engineBus = this.gainNode(context, 1)
    const effectsBus = this.gainNode(context, 1)
    engineBus.connect(master)
    effectsBus.connect(master)

    const engineFilter = (this.engineFilter = this.add(context.createBiquadFilter()))
    engineFilter.type = 'lowpass'
    engineFilter.Q.value = 1.2
    engineFilter.frequency.value = 300
    const engineGain = (this.engineGain = this.gainNode(context, 0.08))
    engineFilter.connect(engineGain)
    engineGain.connect(engineBus)
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'square']
    this.engineOscillators = types.map((type, index) => {
      const oscillator = this.oscillator(context, type, 35)
      oscillator.detune.value = this.engineDetunes[index]
      const mix = this.gainNode(context, index === 2 ? 0.25 : 0.5)
      oscillator.connect(mix)
      mix.connect(engineFilter)
      return oscillator
    })

    this.turboOscillator = this.oscillator(context, 'sine', 2400)
    this.turboGain = this.gainNode(context, 0)
    this.turboOscillator.connect(this.turboGain)
    this.turboGain.connect(engineBus)

    this.jakeOscillator = this.oscillator(context, 'square', 70)
    const jakeBand = this.add(context.createBiquadFilter())
    jakeBand.type = 'bandpass'
    jakeBand.frequency.value = 900
    jakeBand.Q.value = 0.8
    this.jakeGain = this.gainNode(context, 0)
    const jakeGate = this.gainNode(context, 0.5)
    const jakeFlutter = this.oscillator(context, 'square', 26)
    const jakeFlutterDepth = this.gainNode(context, 0.5)
    jakeFlutter.connect(jakeFlutterDepth)
    jakeFlutterDepth.connect(jakeGate.gain)
    this.jakeOscillator.connect(jakeBand)
    jakeBand.connect(jakeGate)
    jakeGate.connect(this.jakeGain)
    this.jakeGain.connect(effectsBus)

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const samples = noiseBuffer.getChannelData(0)
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1
    const noise = this.add(context.createBufferSource())
    noise.buffer = noiseBuffer
    noise.loop = true
    this.sources.push(noise)
    const hissFilter = this.add(context.createBiquadFilter())
    hissFilter.type = 'bandpass'
    hissFilter.frequency.value = 5500
    hissFilter.Q.value = 0.6
    this.hissGain = this.gainNode(context, 0)
    noise.connect(hissFilter)
    hissFilter.connect(this.hissGain)
    this.hissGain.connect(effectsBus)

    const beeper = this.oscillator(context, 'square', 1000)
    const beeperGate = this.gainNode(context, 0.5)
    const beeperClock = this.oscillator(context, 'square', 1)
    const beeperClockDepth = this.gainNode(context, 0.5)
    beeperClock.connect(beeperClockDepth)
    beeperClockDepth.connect(beeperGate.gain)
    this.beeperGain = this.gainNode(context, 0)
    beeper.connect(beeperGate)
    beeperGate.connect(this.beeperGain)
    this.beeperGain.connect(effectsBus)

    const hornFrequencies = [...STOCK_HORN_HZ, ...AIR_HORN_HZ]
    const hornFilter = this.add(context.createBiquadFilter())
    hornFilter.type = 'lowpass'
    hornFilter.frequency.value = 2200
    hornFilter.connect(effectsBus)
    this.hornGains = hornFrequencies.map((frequency, index) => {
      const oscillator = this.oscillator(context, index < STOCK_HORN_HZ.length ? 'square' : 'sawtooth', frequency)
      const gain = this.gainNode(context, 0)
      oscillator.connect(gain)
      gain.connect(hornFilter)
      return gain
    })

    this.hydraulicOscillator = this.oscillator(context, 'sawtooth', 170)
    const hydraulicFilter = this.add(context.createBiquadFilter())
    hydraulicFilter.type = 'lowpass'
    hydraulicFilter.frequency.value = 900
    this.hydraulicGain = this.gainNode(context, 0)
    this.hydraulicOscillator.connect(hydraulicFilter)
    hydraulicFilter.connect(this.hydraulicGain)
    this.hydraulicGain.connect(effectsBus)

    for (const source of this.sources) source.start()
    this.setEngine(this.engine.rpm, this.engine.load)
    this.setJakeBrake(this.jakeOn)
    this.setBackupBeeper(this.beeperOn)
    this.setHorn(this.hornKind)
    this.setHydraulic(this.hydraulicLevel)
  }
}
