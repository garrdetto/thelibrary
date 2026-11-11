const RPM_LOW = 3000
const RPM_SPAN = 6750
const GRAIN = 0.06
const HOP = GRAIN / 2
const SEARCH = 0.006
const WANDER = 0.25
const LOOKAHEAD = 0.1
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function seamLoop(ctx, buffer) {
  const rate = buffer.sampleRate
  const data = buffer.getChannelData(0)
  const fade = Math.round(rate * 0.12)
  const length = data.length - fade
  const out = ctx.createBuffer(1, length, rate)
  const loop = out.getChannelData(0)
  loop.set(data.subarray(0, length))
  for (let i = 0; i < fade; i++) {
    const a = (i / fade) * (Math.PI / 2)
    loop[i] = data[i] * Math.sin(a) + data[length + i] * Math.cos(a)
  }
  let sum = 0
  for (let i = 0; i < length; i++) sum += loop[i] * loop[i]
  return { buffer: out, rms: Math.sqrt(sum / length) || 1 }
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

function bestMatch(data, rate, natural, desired) {
  const span = Math.round(rate * SEARCH)
  const length = Math.round(rate * HOP)
  const a = Math.round(natural * rate)
  const b0 = Math.round(desired * rate)
  const score = (b) => {
    let sum = 0
    let energy = 1e-9
    for (let i = 0; i < length; i += 4) {
      sum += data[a + i] * data[b + i]
      energy += data[b + i] * data[b + i]
    }
    return sum / Math.sqrt(energy)
  }
  const valid = (b) => b >= 0 && b + length < data.length && a >= 0 && a + length < data.length
  let best = b0
  let top = -Infinity
  for (let lag = -span; lag <= span; lag += 3) {
    const b = b0 + lag
    if (!valid(b)) continue
    const s = score(b)
    if (s > top) {
      top = s
      best = b
    }
  }
  for (let b = best - 3; b <= best + 3; b++) {
    if (!valid(b)) continue
    const s = score(b)
    if (s > top) {
      top = s
      best = b
    }
  }
  return best / rate
}

export async function loadEngineAudio(ctx, baseUrl) {
  const base = new URL(baseUrl)
  const manifest = await fetch(new URL('manifest.json', base)).then((r) => {
    if (!r.ok) throw new Error('engine manifest ' + r.status)
    return r.json()
  })
  const decode = (file) =>
    fetch(new URL(file, base))
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
  const [idle, pull] = await Promise.all([decode(manifest.idle.file), decode(manifest.pull.file)])
  return {
    idle: seamLoop(ctx, idle),
    pull: { buffer: pull, points: manifest.pull.points, rms: manifest.pull.rms, ratio: manifest.pull.to / manifest.pull.from },
  }
}

export function createEngineVoice(ctx, assets, destination) {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 12000
  filter.Q.value = 0.5
  const out = ctx.createGain()
  out.gain.value = 0
  filter.connect(out).connect(destination)
  const idleSource = ctx.createBufferSource()
  idleSource.buffer = assets.idle.buffer
  idleSource.loop = true
  const idleGain = ctx.createGain()
  idleGain.gain.value = 0
  idleSource.connect(idleGain).connect(filter)
  idleSource.start(0, Math.random() * assets.idle.buffer.duration)
  const pullGain = ctx.createGain()
  pullGain.gain.value = 0
  pullGain.connect(filter)
  const pull = assets.pull
  const data = pull.buffer.getChannelData(0)
  const sampleRate = pull.buffer.sampleRate
  const lastStart = Math.min(pull.buffer.duration, pull.points[pull.points.length - 1]) - GRAIN
  const timeAt = (x) => sample(pull.points, clamp(x, 0, 1))
  const window = Float32Array.from({ length: 128 }, (_, i) => Math.sin((Math.PI * i) / 127) ** 2)
  let next = 0
  let offset = -1
  let wander = 0
  let lastRate = 1
  let load = 0
  let lastT = 0

  function grain(when, start, rate) {
    const source = ctx.createBufferSource()
    source.buffer = pull.buffer
    source.playbackRate.value = rate
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.gain.setValueCurveAtTime(window, when, GRAIN)
    source.connect(gain).connect(pullGain)
    source.start(when, start)
    source.stop(when + GRAIN + 0.01)
  }

  return {
    set(t, rpm, throttle, volume, doppler, cutoff) {
      const gap = Math.max(0, t - lastT)
      const dt = Math.min(gap, 0.1)
      lastT = t
      load += (throttle - load) * Math.min(1, dt * 7)
      const idleWeight = 1 - smoothstep(1400, RPM_LOW, rpm)
      const x = clamp((rpm - RPM_LOW) / RPM_SPAN, 0, 1)
      const level = Math.pow(0.22 / sample(pull.rms, x), 0.3)
      const amp = (1 - idleWeight) * level * (0.5 + 0.5 * load)
      idleGain.gain.setTargetAtTime((idleWeight * 0.3) / assets.idle.rms, t, 0.05)
      idleSource.playbackRate.setTargetAtTime(clamp(rpm / 1100, 0.85, 1.6) * doppler, t, 0.04)
      out.gain.setTargetAtTime(volume, t, 0.08)
      filter.frequency.setTargetAtTime(Math.min(cutoff, 1200 + 10000 * load), t, 0.08)
      if (next < t) next = t
      if (amp < 0.002) {
        pullGain.gain.setTargetAtTime(0, t, 0.06)
        next = t
        offset = -1
        return
      }
      const target = timeAt(x)
      const ahead = clamp(gap * 1.5 + 0.05, LOOKAHEAD, 0.5)
      while (next < t + ahead) {
        wander += HOP
        if (wander > WANDER) wander -= WANDER * (1.6 + 0.4 * Math.random())
        const desired = clamp(target + wander, 0, lastStart)
        const start = offset < 0 ? desired : clamp(bestMatch(data, sampleRate, offset + HOP * lastRate, desired), 0, lastStart)
        const rate = clamp(Math.pow(pull.ratio, x - locate(pull.points, start)), 0.9, 1.1) * doppler
        grain(next, start, rate)
        lastRate = rate
        offset = start
        next += HOP
      }
      pullGain.gain.setTargetAtTime(amp, t, 0.06)
    },
  }
}
