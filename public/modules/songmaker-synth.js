const keyNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const scaleOptions = [
  { id: "major", label: "Major \xB7 bright" },
  { id: "minor", label: "Minor \xB7 moody" },
  { id: "dorian", label: "Dorian \xB7 soulful" },
  { id: "mixolydian", label: "Mixolydian \xB7 bluesy" },
  { id: "phrygian", label: "Phrygian \xB7 dark" },
  { id: "harmonic-minor", label: "Harmonic minor \xB7 dramatic" }
];
const grooveOptions = [
  { id: "pop", label: "Pop backbeat" },
  { id: "four-floor", label: "Four on the floor" },
  { id: "rock", label: "Rock" },
  { id: "boom-bap", label: "Boom bap" },
  { id: "trap", label: "Trap" },
  { id: "halftime", label: "Half-time" },
  { id: "dembow", label: "Dembow" },
  { id: "afro", label: "Afro groove" },
  { id: "shuffle", label: "Shuffle" },
  { id: "none", label: "No drums" }
];
const chordOptions = [
  { id: "piano", label: "Piano" },
  { id: "e-piano", label: "Electric piano" },
  { id: "pad", label: "Synth pad" },
  { id: "organ", label: "Organ" },
  { id: "guitar", label: "Strummed guitar" },
  { id: "distorted", label: "Distorted guitar" },
  { id: "pluck", label: "Arpeggio pluck" },
  { id: "off", label: "Off" }
];
const bassOptions = [
  { id: "sub", label: "Sub bass" },
  { id: "synth", label: "Synth bass" },
  { id: "808", label: "808" },
  { id: "picked", label: "Picked bass" },
  { id: "off", label: "Off" }
];
const leadOptions = [
  { id: "soft", label: "Soft synth" },
  { id: "square", label: "Retro square" },
  { id: "bell", label: "Bell" },
  { id: "flute", label: "Airy flute" },
  { id: "off", label: "Off" }
];
const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11]
};
const majorProgressions = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4], [3, 0, 4, 5], [0, 4, 3, 3], [0, 3, 0, 4]];
const minorProgressions = [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4], [5, 6, 0, 0], [0, 2, 6, 3], [0, 5, 3, 4], [0, 3, 6, 2]];
const bridgeProgressions = [[3, 4, 5, 4], [5, 3, 4, 4], [3, 5, 3, 4], [5, 4, 3, 4]];
const leadRhythms = [
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
  [[2, 2], [4, 2], [6, 2], [8, 6], [14, 2]],
  [[0, 4], [4, 2], [6, 2], [8, 8]],
  [[0, 2], [3, 1], [4, 4], [10, 2], [12, 2], [14, 2]],
  [[0, 6], [6, 2], [8, 2], [10, 6]]
];
const keyRhythms = [[[0, 16]], [[0, 8], [8, 8]], [[0, 6], [6, 6], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]], [[0, 4], [4, 4], [8, 4], [12, 4]]];
const drumPatterns = {
  pop: { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  "four-floor": { kick: [0, 4, 8, 12], snare: [4, 12], hat: [], open: [2, 6, 10, 14], clap: true },
  rock: { kick: [0, 7, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  "boom-bap": { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  trap: { kick: [0, 7, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], clap: true, rolls: true },
  halftime: { kick: [0, 7], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  dembow: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  afro: { kick: [0, 7, 10], snare: [3, 6, 12], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], clap: true },
  shuffle: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] }
};
const bassRhythms = {
  pop: [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
  "four-floor": [[2, 2], [6, 2], [10, 2], [14, 2]],
  rock: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  "boom-bap": [[0, 6], [7, 3], [10, 6]],
  trap: [[0, 7], [7, 3], [10, 6]],
  halftime: [[0, 7], [7, 9]],
  dembow: [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
  afro: [[0, 3], [3, 4], [7, 3], [10, 6]],
  shuffle: [[0, 4], [4, 4], [8, 4], [12, 4]],
  none: [[0, 8], [8, 8]]
};
const genreProfiles = [
  { pattern: /drill/, values: { tempo: 142, groove: "trap", scale: "harmonic-minor", chords: "pad", bass: "808", lead: "bell", barsPerLine: 1 } },
  { pattern: /trap|phonk/, values: { tempo: 140, groove: "trap", scale: "minor", chords: "pad", bass: "808", lead: "bell", barsPerLine: 1 } },
  { pattern: /old school/, values: { tempo: 94, groove: "boom-bap", swing: 0.3, chords: "e-piano", sevenths: true, bass: "synth", lead: "off", barsPerLine: 1 } },
  { pattern: /rap|hip.?hop/, values: { tempo: 90, groove: "boom-bap", swing: 0.25, chords: "piano", bass: "sub", lead: "soft", barsPerLine: 1 } },
  { pattern: /metal/, values: { tempo: 150, groove: "rock", scale: "phrygian", chords: "distorted", bass: "picked", lead: "square" } },
  { pattern: /pop.?punk|punk/, values: { tempo: 168, groove: "rock", chords: "distorted", bass: "picked", lead: "square" } },
  { pattern: /emo|grunge/, values: { tempo: 120, groove: "rock", chords: "distorted", bass: "picked", lead: "off" } },
  { pattern: /rock/, values: { tempo: 124, groove: "rock", chords: "guitar", bass: "picked", lead: "square" } },
  { pattern: /country|folk/, values: { tempo: 100, groove: "pop", chords: "guitar", bass: "picked", lead: "flute" } },
  { pattern: /r&b|soul|gospel/, values: { tempo: 74, groove: "halftime", chords: "e-piano", sevenths: true, bass: "sub", lead: "soft" } },
  { pattern: /jazz|blues/, values: { tempo: 112, groove: "shuffle", swing: 0.5, chords: "organ", sevenths: true, bass: "picked", lead: "flute" } },
  { pattern: /funk/, values: { tempo: 108, groove: "pop", swing: 0.15, chords: "organ", sevenths: true, bass: "synth", lead: "square" } },
  { pattern: /lo-?fi/, values: { tempo: 78, groove: "boom-bap", swing: 0.35, chords: "e-piano", sevenths: true, bass: "sub", lead: "soft", reverb: 0.4 } },
  { pattern: /synthwave/, values: { tempo: 108, groove: "four-floor", chords: "pad", bass: "synth", lead: "square", reverb: 0.45 } },
  { pattern: /reggae/, values: { tempo: 76, groove: "halftime", chords: "organ", bass: "sub", lead: "flute" } },
  { pattern: /musical theatre|theater/, values: { tempo: 100, groove: "pop", chords: "piano", bass: "picked", lead: "flute" } },
  { pattern: /kids|sing-?along/, values: { tempo: 116, groove: "pop", scale: "major", chords: "piano", bass: "picked", lead: "bell" } },
  { pattern: /edm|electronic|house|techno|dance/, values: { tempo: 124, groove: "four-floor", chords: "pluck", bass: "synth", lead: "soft" } },
  { pattern: /reggaeton/, values: { tempo: 94, groove: "dembow", chords: "pluck", bass: "sub", lead: "bell" } },
  { pattern: /afro/, values: { tempo: 104, groove: "afro", chords: "pluck", bass: "sub", lead: "flute" } },
  { pattern: /k-?pop|boyband/, values: { tempo: 116, groove: "four-floor", chords: "piano", bass: "synth", lead: "soft" } },
  { pattern: /pop/, values: { tempo: 108, groove: "pop", chords: "piano", bass: "synth", lead: "soft" } }
];
function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const styleHints = [
  [/rhodes|electric piano|e-piano/, { chords: "e-piano" }],
  [/piano|keys/, { chords: "piano" }],
  [/organ/, { chords: "organ" }],
  [/distort|heavy|power chord|metal/, { chords: "distorted" }],
  [/acoustic|guitar|strum/, { chords: "guitar" }],
  [/arpegg|pluck/, { chords: "pluck" }],
  [/\bpads?\b|ambient|synth/, { chords: "pad" }],
  [/808/, { bass: "808" }],
  [/no drums|a ?cappella|drumless/, { groove: "none" }],
  [/four on the floor|club/, { groove: "four-floor" }],
  [/swing|shuffle/, { swing: 0.45 }],
  [/whistle|flute/, { lead: "flute" }],
  [/\bbells?\b|glocken/, { lead: "bell" }]
];
function defaultArrangement(direction) {
  const genre = (direction.genre || "Pop").toLowerCase();
  const mood = (direction.mood || "").toLowerCase();
  const style = (direction.style || "").toLowerCase();
  const profile = genreProfiles.find((item) => item.pattern.test(genre))?.values || {};
  const hints = Object.assign({}, ...styleHints.filter(([pattern]) => pattern.test(style)).map(([, values]) => values));
  const moodScale = /happy|hype|romantic|funny|joy|hope/.test(mood) ? "major" : /chill|dreamy/.test(mood) ? "dorian" : /epic/.test(mood) ? "harmonic-minor" : /sad|dark|bittersweet/.test(mood) ? "minor" : "major";
  const baseTempo = profile.tempo || 104;
  const tempoScale = direction.tempo === "slow" ? 0.8 : direction.tempo === "fast" ? 1.2 : 1;
  const seed = hashText(`${direction.title || ""}|${genre}|${mood}`);
  return {
    groove: "pop",
    swing: 0,
    chords: "piano",
    sevenths: false,
    bass: "synth",
    lead: "soft",
    barsPerLine: 2,
    reverb: /dreamy|chill|epic|sad/.test(mood) ? 0.45 : /hype/.test(mood) ? 0.15 : 0.25,
    ...profile,
    ...hints,
    tempo: Math.round(Math.min(180, Math.max(60, baseTempo * tempoScale))),
    scale: profile.scale || moodScale,
    key: seed % 12,
    leadEverywhere: false,
    seed,
    mix: { drums: 0.8, bass: 0.75, chords: 0.65, lead: 0.55 }
  };
}
function sectionKind(label) {
  if (label === "intro") return "intro";
  if (/^verse/.test(label)) return "verse";
  if (/^pre-(chorus|hook)/.test(label)) return "pre";
  if (/chorus|hook/.test(label)) return "chorus";
  if (/^(bridge|breakdown|interlude|instrumental)/.test(label)) return "bridge";
  if (label === "outro") return "outro";
  return null;
}
function parseSections(lyrics, barsPerLine) {
  const sections = [];
  for (const raw of lyrics.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^\[([^\[\]]+)\]$/);
    if (header) {
      const label = header[1].trim().toLowerCase();
      const kind = sectionKind(label);
      if (kind) sections.push({ kind, label, lines: [], bars: 0 });
      continue;
    }
    if (!sections.length) sections.push({ kind: "verse", label: "verse", lines: [], bars: 0 });
    sections[sections.length - 1].lines.push(line.replace(/\[[^\]]*\]/g, "").trim());
  }
  if (sections.length === 1 && sections[0].label === "verse" && sections[0].lines.length > 4) {
    const lines = sections.pop().lines;
    for (let start = 0; start < lines.length; start += 4) {
      const kind = start / 4 % 2 ? "chorus" : "verse";
      sections.push({ kind, label: kind, lines: lines.slice(start, start + 4), bars: 0 });
    }
  }
  if (!sections.length) sections.push(...["intro", "verse", "chorus", "verse", "chorus", "outro"].map((kind) => ({ kind, label: kind, lines: [], bars: 0 })));
  if (sections[0].kind !== "intro") sections.unshift({ kind: "intro", label: "intro", lines: [], bars: 0 });
  return sections.map((section) => ({ ...section, bars: Math.min(32, Math.max(4, Math.ceil(section.lines.length * barsPerLine / 4) * 4)) }));
}
const midiFrequency = (note) => 440 * 2 ** ((note - 69) / 12);
function scaleNote(arrangement, degree, base) {
  const steps = scales[arrangement.scale];
  const octave = Math.floor(degree / 7);
  return base + arrangement.key + steps[(degree % 7 + 7) % 7] + octave * 12;
}
function chordNotes(arrangement, degree) {
  const notes = [0, 2, 4, ...arrangement.sevenths ? [6] : []].map((offset) => scaleNote(arrangement, degree + offset, 48));
  return notes.map((note) => {
    let value = note;
    while (value < 52) value += 12;
    while (value > 69) value -= 12;
    return value;
  }).sort((a, b) => a - b);
}
async function renderSong(lyrics, arrangement, options = {}) {
  const { onProgress } = options;
  const random = seededRandom(arrangement.seed);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const sections = parseSections(lyrics, arrangement.barsPerLine);
  const beat = 60 / arrangement.tempo;
  const bar = beat * 4;
  const step = beat / 4;
  const maxBars = Math.max(4, Math.floor(Math.min(420, options.maxSeconds || 420) / bar));
  let totalBars = 0;
  const timeline = sections.map((section) => {
    const bars = Math.max(0, Math.min(section.bars, maxBars - totalBars));
    const start = totalBars;
    totalBars += bars;
    return { ...section, bars, start };
  }).filter((section) => section.bars > 0);
  const duration = totalBars * bar + 3;
  const sampleRate = 44100;
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(duration * sampleRate), sampleRate });
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;
  const master = context.createGain();
  master.gain.value = 0.8;
  if (sections.reduce((sum, section) => sum + section.bars, 0) > totalBars) {
    master.gain.setValueAtTime(0.8, Math.max(0, (totalBars - 1) * bar));
    master.gain.linearRampToValueAtTime(0, totalBars * bar);
  }
  master.connect(compressor).connect(context.destination);
  const reverb = context.createConvolver();
  const impulse = context.createBuffer(2, Math.floor(sampleRate * 2.4), sampleRate);
  const noiseRandom = seededRandom(arrangement.seed ^ 2654435769);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] = (noiseRandom() * 2 - 1) * (1 - index / data.length) ** 3;
  }
  reverb.buffer = impulse;
  const reverbReturn = context.createGain();
  reverbReturn.gain.value = arrangement.reverb * 0.9;
  reverb.connect(reverbReturn).connect(master);
  const track = (level, send) => {
    const gain = context.createGain();
    gain.gain.value = level;
    gain.connect(master);
    const sendGain = context.createGain();
    sendGain.gain.value = send;
    gain.connect(sendGain).connect(reverb);
    return gain;
  };
  const drumBus = track(arrangement.mix.drums, 0.12);
  const bassBus = track(arrangement.mix.bass * 0.9, 0.04);
  const chordBus = track(arrangement.mix.chords * 0.55, 0.7);
  const leadBus = track(arrangement.mix.lead * 0.5, 0.8);
  const noise = context.createBuffer(1, sampleRate, sampleRate);
  const noiseData = noise.getChannelData(0);
  for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = noiseRandom() * 2 - 1;
  const distortion = new Float32Array(1024).map((_, index) => {
    const x = index / 512 - 1;
    return Math.tanh(x * 4);
  });
  let amp = null;
  const guitarAmp = () => {
    if (amp) return amp;
    const shaper = context.createWaveShaper();
    shaper.curve = distortion;
    const level = context.createGain();
    level.gain.value = 0.3;
    shaper.connect(filter("lowpass", 2600)).connect(level).connect(chordBus);
    amp = shaper;
    return shaper;
  };
  const events = [];
  const later = (play) => (time, ...args) => {
    events.push({ time, run: () => play(time, ...args) });
  };
  const envelope = (time, attack, peak2, decay, sustain, end, release) => {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak2, time + attack);
    gain.gain.setTargetAtTime(Math.max(peak2 * sustain, 1e-4), time + attack, decay);
    gain.gain.setTargetAtTime(0, Math.max(end, time + attack + 1e-3), release);
    return gain;
  };
  const oscillator = (type, frequency, time, stop, detune = 0) => {
    const node = context.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    node.start(time);
    node.stop(stop);
    return node;
  };
  const noiseSource = (time, length) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.start(time, random() * 0.5, length);
    return source;
  };
  const filter = (type, frequency, q = 0.8) => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const kick = later((time, velocity) => {
    const body = oscillator("sine", 150, time, time + 0.5);
    body.frequency.setValueAtTime(150, time);
    body.frequency.exponentialRampToValueAtTime(44, time + 0.13);
    const gain = envelope(time, 2e-3, velocity, 0.12, 1e-3, time + 0.3, 0.05);
    body.connect(gain).connect(drumBus);
  });
  const snare = later((time, velocity, clap) => {
    const hiss = noiseSource(time, 0.3);
    const band = filter(clap ? "bandpass" : "highpass", clap ? 1300 : 1600, clap ? 1.2 : 0.7);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    if (clap) for (const offset of [0, 0.012, 0.024]) {
      gain.gain.setValueAtTime(velocity * 0.9, time + offset);
      gain.gain.setTargetAtTime(velocity * 0.2, time + offset + 2e-3, 4e-3);
    }
    else gain.gain.setValueAtTime(velocity * 0.7, time);
    gain.gain.setTargetAtTime(0, time + (clap ? 0.03 : 0.01), clap ? 0.06 : 0.05);
    hiss.connect(band).connect(gain).connect(drumBus);
    if (!clap) {
      const tone = oscillator("triangle", 190, time, time + 0.2);
      tone.connect(envelope(time, 1e-3, velocity * 0.5, 0.04, 1e-3, time + 0.08, 0.03)).connect(drumBus);
    }
  });
  const hat = later((time, velocity, open) => {
    const hiss = noiseSource(time, open ? 0.4 : 0.1);
    hiss.connect(filter("highpass", 7200)).connect(envelope(time, 1e-3, velocity * 0.32, open ? 0.09 : 0.018, 1e-3, time + 0.02, 0.02)).connect(drumBus);
  });
  const crash = later((time) => {
    const hiss = noiseSource(time, 0.99);
    hiss.connect(filter("highpass", 4500)).connect(envelope(time, 2e-3, 0.28, 0.45, 1e-3, time + 0.9, 0.3)).connect(drumBus);
  });
  const pianoTone = filter("lowpass", 2800);
  pianoTone.connect(chordBus);
  const softLeadTone = filter("lowpass", 2e3);
  softLeadTone.connect(leadBus);
  const keyVoices = {
    piano: (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const stop = time + Math.min(length, 1.6) + 0.5;
      const gain = envelope(time, 4e-3, velocity * 0.5, 0.6, 1e-3, time + length, 0.12);
      oscillator("triangle", frequency, time, stop).connect(gain);
      const shimmer = context.createGain();
      shimmer.gain.value = 0.25;
      oscillator("sine", frequency * 2, time, stop).connect(shimmer).connect(gain);
      gain.connect(pianoTone);
    },
    "e-piano": (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const modulator = oscillator("sine", frequency, time, time + length + 0.8);
      const depth = context.createGain();
      depth.gain.setValueAtTime(frequency * 1.6, time);
      depth.gain.setTargetAtTime(frequency * 0.2, time, 0.2);
      const carrier = oscillator("sine", frequency, time, time + length + 0.8);
      modulator.connect(depth).connect(carrier.frequency);
      carrier.connect(envelope(time, 3e-3, velocity * 0.55, 0.9, 0.2, time + length, 0.15)).connect(chordBus);
    },
    pad: (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const tone = filter("lowpass", 1300);
      for (const detune of [-8, 8]) oscillator("sawtooth", frequency, time, time + length + 1.2, detune).connect(tone);
      tone.connect(envelope(time, Math.min(0.5, length / 3), velocity * 0.22, 0.4, 0.85, time + length, 0.35)).connect(chordBus);
    },
    organ: (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const gain = envelope(time, 0.01, velocity * 0.18, 0.2, 0.9, time + length, 0.06);
      for (const [harmonic, level] of [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2]]) {
        const partial = context.createGain();
        partial.gain.value = level;
        oscillator("sine", frequency * harmonic, time, time + length + 0.4).connect(partial).connect(gain);
      }
      gain.connect(chordBus);
    },
    guitar: (time, note, length, velocity) => {
      const tone = filter("lowpass", 3800, 1.5);
      tone.frequency.setValueAtTime(3800, time);
      tone.frequency.setTargetAtTime(900, time, 0.15);
      oscillator("sawtooth", midiFrequency(note), time, time + length + 0.5).connect(tone);
      tone.connect(envelope(time, 3e-3, velocity * 0.3, 0.5, 0.15, time + length, 0.08)).connect(chordBus);
    },
    distorted: (time, note, length, velocity) => {
      const gain = envelope(time, 4e-3, velocity * 0.5, 0.3, 0.75, time + length, 0.05);
      for (const detune of [-6, 6]) oscillator("sawtooth", midiFrequency(note), time, time + length + 0.3, detune).connect(gain);
      gain.connect(guitarAmp());
    },
    pluck: (time, note, length, velocity) => {
      const tone = filter("lowpass", 4200, 2);
      tone.frequency.setValueAtTime(4200, time);
      tone.frequency.setTargetAtTime(500, time, 0.06);
      oscillator("square", midiFrequency(note), time, time + length + 0.5).connect(tone);
      tone.connect(envelope(time, 2e-3, velocity * 0.3, 0.12, 1e-3, time + length, 0.05)).connect(chordBus);
    }
  };
  const bassVoices = {
    sub: (time, note, length, velocity) => {
      oscillator("sine", midiFrequency(note), time, time + length + 0.3).connect(envelope(time, 0.01, velocity * 0.9, 0.4, 0.7, time + length, 0.05)).connect(bassBus);
    },
    synth: (time, note, length, velocity) => {
      const tone = filter("lowpass", 900, 3);
      tone.frequency.setValueAtTime(1400, time);
      tone.frequency.setTargetAtTime(300, time, 0.08);
      oscillator("sawtooth", midiFrequency(note), time, time + length + 0.3).connect(tone);
      oscillator("sine", midiFrequency(note), time, time + length + 0.3).connect(tone);
      tone.connect(envelope(time, 4e-3, velocity * 0.55, 0.2, 0.6, time + length, 0.04)).connect(bassBus);
    },
    "808": (time, note, length, velocity) => {
      const body = oscillator("sine", midiFrequency(note + 12), time, time + length + 0.5);
      body.frequency.setValueAtTime(midiFrequency(note + 12), time);
      body.frequency.exponentialRampToValueAtTime(midiFrequency(note), time + 0.06);
      const shaper = context.createWaveShaper();
      shaper.curve = distortion;
      const drive = context.createGain();
      drive.gain.value = 0.35;
      body.connect(drive).connect(shaper).connect(envelope(time, 3e-3, velocity * 0.8, Math.max(0.3, length / 2), 0.4, time + length, 0.08)).connect(bassBus);
    },
    picked: (time, note, length, velocity) => {
      const tone = filter("lowpass", 1600, 1);
      tone.frequency.setValueAtTime(1600, time);
      tone.frequency.setTargetAtTime(450, time, 0.1);
      oscillator("triangle", midiFrequency(note), time, time + length + 0.3).connect(tone);
      oscillator("sawtooth", midiFrequency(note), time, time + length + 0.3).connect(filter("lowpass", 700)).connect(tone);
      tone.connect(envelope(time, 3e-3, velocity * 0.7, 0.35, 0.35, time + length, 0.04)).connect(bassBus);
    }
  };
  const leadVoices = {
    soft: (time, note, length, velocity) => {
      const gain = envelope(time, 0.02, velocity * 0.35, 0.3, 0.7, time + length, 0.08);
      oscillator("triangle", midiFrequency(note), time, time + length + 0.4).connect(gain);
      const buzz = context.createGain();
      buzz.gain.value = 0.35;
      oscillator("sawtooth", midiFrequency(note), time, time + length + 0.4, 5).connect(buzz).connect(gain);
      gain.connect(softLeadTone);
    },
    square: (time, note, length, velocity) => {
      oscillator("square", midiFrequency(note), time, time + length + 0.3).connect(filter("lowpass", 3200)).connect(envelope(time, 5e-3, velocity * 0.2, 0.25, 0.6, time + length, 0.05)).connect(leadBus);
    },
    bell: (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const modulator = oscillator("sine", frequency * 3.5, time, time + length + 1.2);
      const depth = context.createGain();
      depth.gain.setValueAtTime(frequency * 2.5, time);
      depth.gain.setTargetAtTime(frequency * 0.1, time, 0.3);
      const carrier = oscillator("sine", frequency, time, time + length + 1.2);
      modulator.connect(depth).connect(carrier.frequency);
      carrier.connect(envelope(time, 2e-3, velocity * 0.4, 0.7, 1e-3, time + length + 0.4, 0.3)).connect(leadBus);
    },
    flute: (time, note, length, velocity) => {
      const frequency = midiFrequency(note);
      const body = oscillator("sine", frequency, time, time + length + 0.4);
      const vibrato = oscillator("sine", 5.2, time, time + length + 0.4);
      const vibratoDepth = context.createGain();
      vibratoDepth.gain.value = frequency * 6e-3;
      vibrato.connect(vibratoDepth).connect(body.frequency);
      const gain = envelope(time, 0.06, velocity * 0.45, 0.3, 0.8, time + length, 0.1);
      body.connect(gain);
      const breath = noiseSource(time, Math.min(0.99, length + 0.2));
      const breathGain = context.createGain();
      breathGain.gain.value = 0.05;
      breath.connect(filter("bandpass", frequency * 2, 4)).connect(breathGain).connect(gain);
      gain.connect(leadBus);
    }
  };
  const progressionBank = scales[arrangement.scale][2] === 3 ? minorProgressions : majorProgressions;
  const progressions = { intro: [], verse: pick(progressionBank), pre: [], chorus: [], bridge: pick(bridgeProgressions), outro: [] };
  progressions.chorus = pick(progressionBank.filter((item) => item.join() !== progressions.verse.join())) || progressions.verse;
  progressions.pre = [progressions.chorus[3], progressions.verse[1], 3, 4];
  progressions.intro = progressions.chorus;
  progressions.outro = progressions.chorus;
  const keyRhythm = pick(keyRhythms);
  const chorusKeyRhythm = pick(keyRhythms);
  const motif = (bars) => Array.from({ length: bars }, (_, barIndex) => {
    const rhythm = pick(leadRhythms);
    let degree = pick([0, 2, 4]);
    return rhythm.map(([position, length], noteIndex) => {
      if (noteIndex > 0) degree = Math.max(-3, Math.min(9, degree + pick([-2, -1, -1, 1, 1, 2, 0, 3, -3])));
      if (position % 8 === 0 || noteIndex === rhythm.length - 1) degree = [0, 2, 4, 7].reduce((best, tone) => Math.abs(tone - degree) < Math.abs(best - degree) ? tone : best, 0);
      return { position, length: barIndex % 2 === 1 && noteIndex === rhythm.length - 1 ? 16 - position : length, degree };
    });
  });
  const motifs = { intro: [], verse: motif(2), pre: motif(2), chorus: motif(2), bridge: motif(2), outro: [] };
  motifs.intro = motifs.chorus;
  motifs.outro = motifs.chorus;
  const swingOffset = (position) => position % 2 === 1 ? arrangement.swing * step * 0.66 : 0;
  const humanize = () => random() * 6e-3;
  const keyVoice = arrangement.chords === "off" ? null : later(keyVoices[arrangement.chords]);
  const bassVoice = arrangement.bass === "off" ? null : later(bassVoices[arrangement.bass]);
  const leadVoice = arrangement.lead === "off" ? null : later(leadVoices[arrangement.lead]);
  const pattern = arrangement.groove === "none" ? null : drumPatterns[arrangement.groove];
  const at = (barStart, position) => barStart + position * step + swingOffset(position);
  for (const section of timeline) {
    const progression = progressions[section.kind];
    for (let barIndex = 0; barIndex < section.bars; barIndex += 1) {
      const barStart = (section.start + barIndex) * bar;
      const degree = progression[barIndex % progression.length];
      const lastBar = barIndex === section.bars - 1;
      const fade = section.kind === "outro" ? 1 - barIndex / section.bars * 0.7 : 1;
      const energy = section.kind === "chorus" ? 1 : section.kind === "intro" || section.kind === "bridge" ? 0.7 : 0.85;
      if (keyVoice) {
        const notes = chordNotes(arrangement, degree);
        const voicing = arrangement.chords === "distorted" ? [notes[0] - 12, notes[0] - 5, notes[0]] : notes;
        if (arrangement.chords === "pluck") {
          const order = [...voicing, voicing[1] + 12, ...voicing.slice(1).reverse()];
          for (let position = 0; position < 16; position += 2) keyVoice(at(barStart, position) + humanize(), order[position / 2 % order.length], step * 2.5, 0.8 * energy * fade);
        } else if (arrangement.chords === "guitar") {
          for (const [position, length] of [[0, 4], [4, 2], [6, 4], [10, 2], [12, 4]]) voicing.forEach((note, index) => keyVoice(at(barStart, position) + index * 0.012, note, length * step, (position % 4 ? 0.6 : 0.9) * energy * fade));
        } else if (arrangement.chords === "distorted") {
          const hits = section.kind === "chorus" || section.kind === "pre" ? [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]] : section.kind === "verse" ? [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]] : [[0, 16]];
          for (const [position, length] of hits) voicing.forEach((note) => keyVoice(at(barStart, position), note, length * step * 0.9, energy * fade));
        } else if (arrangement.chords === "pad" || arrangement.chords === "organ") voicing.forEach((note) => keyVoice(barStart, note, bar, energy * fade));
        else {
          const rhythm = section.kind === "chorus" ? chorusKeyRhythm : section.kind === "intro" || section.kind === "outro" ? [[0, 16]] : keyRhythm;
          for (const [position, length] of rhythm) voicing.forEach((note) => keyVoice(at(barStart, position) + humanize(), note, length * step, (position === 0 ? 0.85 : 0.65) * energy * fade));
        }
      }
      if (bassVoice && section.kind !== "intro") {
        const root = scaleNote(arrangement, degree, 36) >= 46 ? scaleNote(arrangement, degree, 24) : scaleNote(arrangement, degree, 36);
        const rhythm = arrangement.bass === "808" && pattern ? pattern.kick.map((position, index, all) => [position, (all[index + 1] ?? 16) - position]) : section.kind === "bridge" ? [[0, 16]] : bassRhythms[arrangement.groove];
        rhythm.forEach(([position, length], index) => bassVoice(at(barStart, position), root + (arrangement.groove === "rock" || index % 3 !== 2 || arrangement.bass === "808" ? 0 : 12), length * step * 0.92, 0.9 * fade));
      }
      if (leadVoice && (section.kind === "chorus" || section.kind === "intro" && barIndex >= section.bars - 2 || section.kind === "outro" || arrangement.leadEverywhere)) {
        const phrase = motifs[section.kind][barIndex % 2];
        const register = section.kind === "chorus" ? 72 : 67;
        const variation = barIndex % 4 === 3 ? 1 : 0;
        phrase.forEach(({ position, length, degree: offset }, index) => leadVoice(at(barStart, position), scaleNote(arrangement, degree + offset + (index === phrase.length - 1 ? 0 : variation), register - 12), length * step * 0.95, (position % 4 === 0 ? 0.9 : 0.7) * fade));
      }
      if (pattern && section.kind !== "intro" && !(section.kind === "outro" && barIndex >= section.bars / 2)) {
        const groove = section.kind === "bridge" ? drumPatterns.halftime : pattern;
        const light = section.kind !== "chorus";
        if (barIndex === 0 && (section.kind === "chorus" || section.kind === "verse" && section.start > 4)) crash(barStart);
        groove.kick.forEach((position) => kick(at(barStart, position), 0.95));
        const snareSteps = lastBar && section.kind !== "outro" ? [...groove.snare.filter((position) => position < 12), 12, 13, 14, 15] : groove.snare;
        snareSteps.forEach((position) => snare(at(barStart, position), position > 12 && lastBar ? 0.6 : 0.85, Boolean(groove.clap)));
        groove.hat.forEach((position) => hat(at(barStart, position) + humanize(), (position % 4 === 0 ? 0.9 : 0.6) * (light ? 0.8 : 1), false));
        groove.open?.forEach((position) => hat(at(barStart, position), light ? 0.6 : 0.8, true));
        if (groove.rolls && barIndex % 2 === 1) for (let roll = 0; roll < 6; roll += 1) hat(barStart + 12 * step + roll * step * 0.66, 0.5, false);
        if (!light && groove.hat.length <= 8 && arrangement.groove !== "shuffle") [1, 5, 9, 13].forEach((position) => hat(at(barStart, position), 0.35, false));
      } else if (pattern && section.kind === "intro" && lastBar) [8, 10, 12, 14].forEach((position) => snare(at(barStart, position), 0.4 + position / 40, Boolean(pattern.clap)));
    }
  }
  const cues = [];
  for (const section of timeline) {
    const lineLength = section.bars * bar / Math.max(1, section.lines.length);
    const slot = Math.min(arrangement.barsPerLine * bar, lineLength);
    section.lines.forEach((text, index) => {
      if (text) cues.push({ time: section.start * bar + index * slot, duration: slot, text, section: section.label });
    });
  }
  events.sort((a, b) => a.time - b.time);
  let nextEvent = 0;
  const scheduleUntil = (end) => {
    while (nextEvent < events.length && events[nextEvent].time < end) events[nextEvent++].run();
  };
  const chunk = 2;
  let failure = null;
  if (typeof context.suspend === "function") {
    scheduleUntil(chunk);
    for (let start = chunk; start < duration; start += chunk) {
      const boundary = start;
      context.suspend(boundary - 0.05).then(() => {
        try {
          scheduleUntil(boundary + chunk);
          onProgress?.(boundary / duration);
        } catch (error) {
          failure ?? (failure = error);
        }
        return context.resume();
      }, () => scheduleUntil(Infinity));
    }
  } else scheduleUntil(Infinity);
  const buffer = await context.startRendering();
  if (failure) throw failure;
  onProgress?.(1);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  const peak = channels.reduce((highest, data) => {
    let value = highest;
    for (let index = 0; index < data.length; index += 1) value = Math.max(value, Math.abs(data[index]));
    return value;
  }, 0);
  if (peak > 0) channels.forEach((data) => {
    const scale = 0.89 / peak;
    for (let index = 0; index < data.length; index += 1) data[index] *= scale;
  });
  return { buffer, cues, sections: timeline.map((section) => ({ label: section.label, start: section.start * bar })), duration: totalBars * bar + 3 };
}
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const view = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const write = (offset2, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset2 + index, text.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * channels * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
export {
  bassOptions,
  chordOptions,
  defaultArrangement,
  encodeWav,
  grooveOptions,
  keyNames,
  leadOptions,
  parseSections,
  renderSong,
  scaleOptions
};
