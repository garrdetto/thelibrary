import workletSource from './engine-worklet.js?raw'

function seamLoop(buffer) {
  const data = buffer.getChannelData(0)
  const fade = Math.round(buffer.sampleRate * 0.12)
  const length = data.length - fade
  const loop = new Float32Array(length)
  loop.set(data.subarray(0, length))
  for (let i = 0; i < fade; i++) {
    const a = (i / fade) * (Math.PI / 2)
    loop[i] = data[i] * Math.sin(a) + data[length + i] * Math.cos(a)
  }
  let sum = 0
  for (let i = 0; i < length; i++) sum += loop[i] * loop[i]
  return { data: loop, rms: Math.sqrt(sum / length) || 1 }
}

export async function loadEngineAudio(ctx, baseUrl) {
  if (!ctx.audioWorklet) throw new Error('no audio worklet')
  const base = new URL(baseUrl)
  const manifest = await fetch(new URL('manifest.json', base)).then((r) => {
    if (!r.ok) throw new Error('engine manifest ' + r.status)
    return r.json()
  })
  const decode = (file) =>
    fetch(new URL(file, base))
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
  const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }))
  const [idle, pull] = await Promise.all([decode(manifest.idle.file), decode(manifest.pull.file), ctx.audioWorklet.addModule(url)])
  URL.revokeObjectURL(url)
  return {
    idle: seamLoop(idle),
    pull: { data: pull.getChannelData(0), points: manifest.pull.points, rms: manifest.pull.rms, ratio: manifest.pull.to / manifest.pull.from },
  }
}

export function createEngineVoice(ctx, assets, destination) {
  const node = new AudioWorkletNode(ctx, 'st-engine-voice', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { pull: assets.pull.data, points: assets.pull.points, rms: assets.pull.rms, ratio: assets.pull.ratio, idle: assets.idle.data, idleRms: assets.idle.rms },
  })
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 12000
  filter.Q.value = 0.5
  const out = ctx.createGain()
  out.gain.value = 0
  node.connect(filter).connect(out).connect(destination)
  const rpmParam = node.parameters.get('rpm')
  const throttleParam = node.parameters.get('throttle')
  const dopplerParam = node.parameters.get('doppler')
  return {
    set(t, rpm, throttle, volume, doppler, cutoff) {
      rpmParam.setTargetAtTime(rpm, t, 0.02)
      throttleParam.setTargetAtTime(throttle, t, 0.02)
      dopplerParam.setTargetAtTime(doppler, t, 0.04)
      out.gain.setTargetAtTime(volume, t, 0.08)
      filter.frequency.setTargetAtTime(Math.min(cutoff, 1200 + 10000 * throttle), t, 0.16)
    },
  }
}
