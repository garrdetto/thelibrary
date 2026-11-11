const RPM_LOW = 3000
const RPM_SPAN = 6750
const GRAIN = 0.06
const SEARCH = 0.006
const WANDER = 0.25
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function sample(table, x) {
  const i = clamp(x, 0, 1) * (table.length - 1)
  const a = Math.floor(i)
  const b = Math.min(table.length - 1, a + 1)
  return table[a] + (table[b] - table[a]) * (i - a)
}

function locate(points, time) {
  if (time <= points[0]) return 0
  for (let i = 1; i < points.length; i++) {
    if (time <= points[i]) {
      const span = points[i] - points[i - 1]
      return (i - 1 + (span > 0 ? (time - points[i - 1]) / span : 1)) / (points.length - 1)
    }
  }
  return 1
}

class EngineVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 1000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'doppler', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
    ]
  }

  constructor(options) {
    super()
    const o = options.processorOptions
    this.pull = o.pull
    this.points = o.points
    this.rms = o.rms
    this.ratio = o.ratio
    this.idle = o.idle
    this.idleLevel = 0.3 / o.idleRms
    this.grainLength = Math.round(sampleRate * GRAIN)
    this.hop = this.grainLength >> 1
    this.window = new Float32Array(this.grainLength)
    for (let i = 0; i < this.grainLength; i++) this.window[i] = Math.sin((Math.PI * i) / (this.grainLength - 1)) ** 2
    this.lastStart = Math.min(this.pull.length / sampleRate, this.points[this.points.length - 1]) - GRAIN * 1.25
    this.grains = [0, 1, 2].map(() => ({ position: 0, rate: 1, age: this.grainLength }))
    this.untilNext = 0
    this.offset = -1
    this.lastRate = 1
    this.wander = 0
    this.load = 0
    this.pullGain = 0
    this.idleGain = 0
    this.idlePosition = Math.random() * this.idle.length
    this.idleRate = 1
  }

  score(a, b, length) {
    const data = this.pull
    let sum = 0
    let energy = 1e-9
    for (let i = 0; i < length; i += 4) {
      const y = data[b + i]
      sum += data[a + i] * y
      energy += y * y
    }
    return sum / Math.sqrt(energy)
  }

  match(natural, desired) {
    const length = this.hop
    const span = Math.round(sampleRate * SEARCH)
    const a = Math.round(natural * sampleRate)
    const b0 = Math.round(desired * sampleRate)
    const last = this.pull.length - length - 1
    if (a < 0 || a > last) return desired
    const from = Math.max(0, b0 - span)
    const to = Math.min(last, b0 + span)
    let best = b0
    let top = -Infinity
    for (let b = from; b <= to; b += 3) {
      const s = this.score(a, b, length)
      if (s > top) {
        top = s
        best = b
      }
    }
    const near = best
    for (let b = Math.max(from, near - 2); b <= Math.min(to, near + 2); b++) {
      const s = this.score(a, b, length)
      if (s > top) {
        top = s
        best = b
      }
    }
    return best / sampleRate
  }

  spawn(x, doppler) {
    const hop = this.hop / sampleRate
    this.wander += hop
    if (this.wander > WANDER) this.wander -= WANDER * (1.6 + 0.4 * Math.random())
    const desired = clamp(sample(this.points, x) + this.wander, 0, this.lastStart)
    const start = this.offset < 0 ? desired : clamp(this.match(this.offset + hop * this.lastRate, desired), 0, this.lastStart)
    const rate = clamp(Math.pow(this.ratio, x - locate(this.points, start)), 0.9, 1.1)
    let grain = this.grains[0]
    for (const g of this.grains) if (g.age > grain.age) grain = g
    grain.position = start * sampleRate
    grain.rate = rate * doppler
    grain.age = 0
    this.lastRate = rate
    this.offset = start
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0][0]
    if (!out) return true
    const rpm = parameters.rpm[0]
    const doppler = parameters.doppler[0]
    const frames = out.length
    this.load += (parameters.throttle[0] - this.load) * Math.min(1, (frames / sampleRate) * 7)
    const idleWeight = 1 - smoothstep(1400, RPM_LOW, rpm)
    const x = clamp((rpm - RPM_LOW) / RPM_SPAN, 0, 1)
    const level = Math.pow(0.22 / sample(this.rms, x), 0.3)
    const amp = (1 - idleWeight) * level * (0.5 + 0.5 * this.load)
    const ease = 1 - Math.exp(-1 / (0.05 * sampleRate))
    const idleTarget = idleWeight * this.idleLevel
    const idleRateTarget = clamp(rpm / 1100, 0.85, 1.6) * doppler
    const live = amp >= 0.002
    const pullTarget = live ? amp : 0
    const pull = this.pull
    const idle = this.idle
    const grains = this.grains
    const window = this.window
    const length = this.grainLength
    for (let i = 0; i < frames; i++) {
      if (--this.untilNext <= 0) {
        this.untilNext = this.hop
        if (live || this.pullGain >= 0.0005) this.spawn(x, doppler)
        else this.offset = -1
      }
      this.pullGain += (pullTarget - this.pullGain) * ease
      this.idleGain += (idleTarget - this.idleGain) * ease
      this.idleRate += (idleRateTarget - this.idleRate) * ease
      let v = 0
      for (let g = 0; g < 3; g++) {
        const grain = grains[g]
        if (grain.age >= length) continue
        const p = grain.position
        const k = p | 0
        if (k + 1 < pull.length) v += (pull[k] + (pull[k + 1] - pull[k]) * (p - k)) * window[grain.age]
        grain.position = p + grain.rate
        grain.age++
      }
      let s = v * this.pullGain
      if (this.idleGain > 0.0005) {
        const p = this.idlePosition
        const k = p | 0
        const next = k + 1 < idle.length ? k + 1 : 0
        s += (idle[k] + (idle[next] - idle[k]) * (p - k)) * this.idleGain
      }
      this.idlePosition += this.idleRate
      if (this.idlePosition >= idle.length) this.idlePosition -= idle.length
      out[i] = s
    }
    return true
  }
}

registerProcessor('st-engine-voice', EngineVoice)
