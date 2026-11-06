/** Ballpark sound, all synthesised in the page with Web Audio (no audio files): a crowd bed that swells with the moment, a bat crack graded by contact quality, glove pops, organ riffs, park ambience (The Outhouse's plumbing, Sandlot crickets after dark) and PA lines through the browser's speech engine. Every voice line is also returned as a subtitle. Starts on the first gesture; muted with N. */

export type Ambience = 'outhouse' | 'sandlot' | 'none'

const NOTE = (semitones: number) => 261.63 * Math.pow(2, semitones / 12)
const CHARGE = [0, 4, 7, 12, 7, 12]

export class BallparkAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private crowdGain: GainNode | null = null
  private ambienceGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private excitement = 0.1
  private muted: boolean
  private ambience: Ambience = 'none'
  private night = false
  private ambienceClock = 0
  private readonly unlock = () => this.start()

  constructor(private readonly onSubtitle: (text: string) => void) {
    let stored = false
    try {
      stored = localStorage.getItem('tl-bushleague-muted') === '1'
    } catch {
      stored = false
    }
    this.muted = stored
    addEventListener('pointerdown', this.unlock, { once: true })
    addEventListener('keydown', this.unlock, { once: true })
  }

  get isMuted(): boolean {
    return this.muted
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem('tl-bushleague-muted', this.muted ? '1' : '0')
    } catch {
      return this.muted
    }
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.context.currentTime, 0.05)
    if (this.muted && 'speechSynthesis' in window) speechSynthesis.cancel()
    return this.muted
  }

  private start(): void {
    if (this.context) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const context = new Ctor()
    this.context = context
    this.master = context.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    this.master.connect(context.destination)
    const length = context.sampleRate * 2
    this.noise = context.createBuffer(1, length, context.sampleRate)
    const data = this.noise.getChannelData(0)
    let seed = 12345
    for (let index = 0; index < length; index++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[index] = (seed / 0x7fffffff) * 2 - 1
    }
    const bed = context.createBufferSource()
    bed.buffer = this.noise
    bed.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 0.6
    this.crowdGain = context.createGain()
    this.crowdGain.gain.value = 0.05
    bed.connect(band).connect(this.crowdGain).connect(this.master)
    bed.start()
    this.ambienceGain = context.createGain()
    this.ambienceGain.gain.value = 0.5
    this.ambienceGain.connect(this.master)
  }

  private burst(duration: number, filter: BiquadFilterType, frequency: number, gain: number, q = 1): void {
    const context = this.context
    if (!context || !this.noise || !this.master) return
    const source = context.createBufferSource()
    source.buffer = this.noise
    const shape = context.createBiquadFilter()
    shape.type = filter
    shape.frequency.value = frequency
    shape.Q.value = q
    const envelope = context.createGain()
    const now = context.currentTime
    envelope.gain.setValueAtTime(gain, now)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(shape).connect(envelope).connect(this.master)
    source.start(now, Math.random() * 1.5, duration + 0.05)
  }

  private tone(frequency: number, start: number, duration: number, gain: number, type: OscillatorType = 'sawtooth'): void {
    const context = this.context
    if (!context || !this.master) return
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.value = frequency
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1800
    const envelope = context.createGain()
    const at = context.currentTime + start
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(gain, at + 0.02)
    envelope.gain.setValueAtTime(gain, at + duration * 0.7)
    envelope.gain.linearRampToValueAtTime(0, at + duration)
    oscillator.connect(filter).connect(envelope).connect(this.master)
    oscillator.start(at)
    oscillator.stop(at + duration + 0.05)
  }

  /** Contact quality 0 (off the end) to 1 (barrel): a sharp, bright crack for squared-up balls, a dull thud for weak ones. */
  bat(quality: number): void {
    this.burst(0.08 + quality * 0.07, 'bandpass', 900 + quality * 2600, 0.4 + quality * 0.5, 1.2)
    this.burst(0.03, 'highpass', 4000, 0.15 + quality * 0.25)
  }

  glove(): void {
    this.burst(0.06, 'lowpass', 900, 0.35)
  }

  /** Crowd level 0–1; it eases back down on its own. */
  swell(level: number): void {
    this.excitement = Math.max(this.excitement, level)
  }

  charge(): void {
    CHARGE.forEach((step, index) => this.tone(NOTE(step), index * 0.16, index === CHARGE.length - 1 ? 0.6 : 0.14, 0.09))
  }

  organ(): void {
    const riff = [0, 2, 4, 5, 7, 9, 11, 12]
    riff.forEach((step, index) => this.tone(NOTE(step - 12), index * 0.12, 0.11, 0.06, 'square'))
  }

  setAmbience(ambience: Ambience, night: boolean): void {
    this.ambience = ambience
    this.night = night
  }

  /** A PA or umpire line: spoken when sound is on and the browser can speak, always returned as a subtitle. */
  say(text: string, voice: 'pa' | 'umpire' | 'vendor' = 'pa'): void {
    this.onSubtitle(text)
    if (this.muted || !this.context || !('speechSynthesis' in window)) return
    const line = new SpeechSynthesisUtterance(text)
    line.rate = voice === 'umpire' ? 1.15 : voice === 'vendor' ? 1.25 : 0.92
    line.pitch = voice === 'umpire' ? 0.7 : voice === 'vendor' ? 1.3 : 0.85
    line.volume = voice === 'vendor' ? 0.5 : 0.9
    speechSynthesis.cancel()
    speechSynthesis.speak(line)
  }

  update(dt: number): void {
    if (!this.context || !this.crowdGain) return
    this.excitement = Math.max(0.1, this.excitement - dt * 0.18)
    this.crowdGain.gain.setTargetAtTime(0.04 + this.excitement * 0.32, this.context.currentTime, 0.25)
    this.ambienceClock += dt
    if (this.ambience === 'outhouse' && this.ambienceClock > 9) {
      this.ambienceClock = 0
      this.burst(1.4, 'lowpass', 420, 0.12, 4)
    }
    if (this.ambience === 'sandlot' && this.night && this.ambienceClock > 0.9) {
      this.ambienceClock = 0
      for (let chirp = 0; chirp < 3; chirp++) this.tone(4200 + Math.random() * 300, chirp * 0.07, 0.04, 0.012, 'sine')
    }
  }

  dispose(): void {
    removeEventListener('pointerdown', this.unlock)
    removeEventListener('keydown', this.unlock)
    if ('speechSynthesis' in window) speechSynthesis.cancel()
    void this.context?.close()
  }
}
