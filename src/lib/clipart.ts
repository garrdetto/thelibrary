export const CLIPART_GROUPS = [
  { id: 'detail', label: 'Detail' },
  { id: 'realism', label: 'Realism' },
  { id: 'clipart', label: 'Clipart style' },
  { id: 'color', label: 'Color and lighting' },
  { id: 'quality', label: 'Image quality' },
] as const
export type ClipartGroup = (typeof CLIPART_GROUPS)[number]['id']

type LevelSlider = { key: string; label: string; group: ClipartGroup; kind: 'level'; low: string; mid: string; high: string; keyword: string; avoid?: string }
type BalanceSlider = { key: string; label: string; group: ClipartGroup; kind: 'balance'; up: string; down: string; keywordUp: string; keywordDown: string }
export type ClipartSlider = LevelSlider | BalanceSlider

export const CLIPART_SLIDERS = [
  { key: 'overallDetail', label: 'Overall detail', group: 'detail', kind: 'level', low: 'simplified forms with only the main shapes', mid: 'clearly rendered detail across the scene', high: 'intricate, densely rendered detail everywhere in the scene', keyword: 'ultra detailed', avoid: 'busy detail' },
  { key: 'fineDetail', label: 'Fine detail', group: 'detail', kind: 'level', low: 'small details merged into larger shapes', mid: 'small details kept readable', high: 'every small element crisply resolved: trim, bolts, leaves, railings, wires', keyword: 'fine intricate details' },
  { key: 'textureDetail', label: 'Texture detail', group: 'detail', kind: 'level', low: 'smooth, mostly untextured surfaces', mid: 'visible surface textures', high: 'richly rendered textures on brick, wood grain, bark, asphalt, shingles and foliage', keyword: 'detailed textures', avoid: 'heavy texture' },
  { key: 'architecturalDetail', label: 'Architectural detail', group: 'detail', kind: 'level', low: 'buildings reduced to clean massing', mid: 'windows, doors and trim drawn accurately', high: 'precise architecture: every window pane, mullion, cornice, gutter, shingle row and brick course', keyword: 'precise architectural detail' },
  { key: 'objectDetail', label: 'Object detail', group: 'detail', kind: 'level', low: 'vehicles and objects simplified', mid: 'vehicles, signs and objects drawn faithfully', high: 'vehicles, signs, street furniture and objects rendered with full modelled detail', keyword: 'detailed vehicles and objects' },
  { key: 'edgeDefinition', label: 'Edge definition', group: 'detail', kind: 'level', low: 'soft, gently blended edges', mid: 'well-defined edges', high: 'razor-sharp, perfectly defined edges between every shape', keyword: 'crisp edges', avoid: 'hard edges' },
  { key: 'photoRealism', label: 'Photographic realism', group: 'realism', kind: 'level', low: 'clearly illustrated rather than photographic', mid: 'a realistic illustration with believable proportions', high: 'near-photographic realism while still reading as illustrated artwork', keyword: 'photorealistic illustration', avoid: 'photorealistic' },
  { key: 'realisticTextures', label: 'Realistic textures', group: 'realism', kind: 'level', low: 'stylised, painted textures', mid: 'textures that resemble the real materials', high: 'textures that match the real materials closely', keyword: 'realistic textures', avoid: 'realistic textures' },
  { key: 'naturalLighting', label: 'Natural lighting', group: 'realism', kind: 'level', low: 'flat, even studio lighting', mid: 'natural daylight', high: 'natural sunlight with correct direction, soft bounce light and sky fill', keyword: 'natural lighting' },
  { key: 'shadowRealism', label: 'Shadow realism', group: 'realism', kind: 'level', low: 'minimal, simplified shadows', mid: 'believable cast shadows', high: 'physically accurate cast and contact shadows with soft penumbras', keyword: 'realistic shadows', avoid: 'cast shadows' },
  { key: 'materialRealism', label: 'Material realism', group: 'realism', kind: 'level', low: 'materials suggested with flat colour', mid: 'materials that read clearly as glass, metal, wood or stone', high: 'convincing glass reflections, metal sheen, painted siding, stone and wood', keyword: 'realistic materials' },
  { key: 'clipartIntensity', label: 'Clipart intensity', group: 'clipart', kind: 'level', low: 'only a light illustrated finish over the photo', mid: 'a clear professional clipart look', high: 'a bold, unmistakable premium clipart look', keyword: 'professional clipart', avoid: 'clipart, flat colors' },
  { key: 'illustrationStrength', label: 'Illustration strength', group: 'clipart', kind: 'level', low: 'barely stylised', mid: 'clearly hand-illustrated', high: 'fully illustrated in every area, no photographic remnants', keyword: 'digital illustration', avoid: 'illustration' },
  { key: 'outlineDefinition', label: 'Outline definition', group: 'clipart', kind: 'level', low: 'no outlines, shapes separated by colour only', mid: 'thin, subtle outlines', high: 'clean, confident dark outlines around shapes', keyword: 'clean outlines', avoid: 'outlines, line art' },
  { key: 'digitalPainting', label: 'Digital painting strength', group: 'clipart', kind: 'level', low: 'smooth vector-like fills', mid: 'some painterly shading', high: 'rich digital-painting brushwork in the shading', keyword: 'digital painting', avoid: 'brush strokes' },
  { key: 'cleanEdges', label: 'Clean edge enhancement', group: 'clipart', kind: 'level', low: 'natural, slightly rough edges', mid: 'tidy edges', high: 'immaculately clean, anti-aliased illustrated edges with no fringing or halos', keyword: 'clean vector edges' },
  { key: 'vibrance', label: 'Color vibrance', group: 'color', kind: 'balance', up: 'boost the vibrance of muted colours', down: 'mute the colours', keywordUp: 'vibrant colors', keywordDown: 'muted colors' },
  { key: 'richness', label: 'Color richness', group: 'color', kind: 'balance', up: 'make colours deeper and richer', down: 'keep colours light and airy', keywordUp: 'rich deep colors', keywordDown: 'pastel colors' },
  { key: 'brightness', label: 'Brightness', group: 'color', kind: 'balance', up: 'brighten the overall image', down: 'darken the overall image', keywordUp: 'bright', keywordDown: 'dark moody' },
  { key: 'contrast', label: 'Contrast', group: 'color', kind: 'balance', up: 'raise the contrast', down: 'lower the contrast', keywordUp: 'high contrast', keywordDown: 'low contrast' },
  { key: 'shadowBrightness', label: 'Shadow brightness', group: 'color', kind: 'balance', up: 'lift the shadows', down: 'deepen the shadows', keywordUp: 'lifted shadows', keywordDown: 'deep shadows' },
  { key: 'highlightBrightness', label: 'Highlight brightness', group: 'color', kind: 'balance', up: 'brighten the highlights', down: 'tame the highlights', keywordUp: 'bright highlights', keywordDown: 'soft highlights' },
  { key: 'saturation', label: 'Saturation', group: 'color', kind: 'balance', up: 'increase saturation', down: 'reduce saturation', keywordUp: 'saturated', keywordDown: 'desaturated' },
  { key: 'hdEnhancement', label: 'HD enhancement', group: 'quality', kind: 'level', low: 'standard definition finish', mid: 'a clean high-definition finish', high: 'a pristine ultra-HD finish', keyword: '8k ultra hd' },
  { key: 'sharpness', label: 'Sharpness', group: 'quality', kind: 'level', low: 'soft focus', mid: 'sharp focus', high: 'tack-sharp focus across the whole frame', keyword: 'sharp focus', avoid: 'oversharpened' },
  { key: 'clarity', label: 'Clarity', group: 'quality', kind: 'level', low: 'gentle, hazy mid-tones', mid: 'clear mid-tone separation', high: 'strong local clarity so every surface reads clearly', keyword: 'high clarity' },
  { key: 'noiseReduction', label: 'Noise reduction', group: 'quality', kind: 'level', low: 'keep some natural grain', mid: 'clean surfaces with little noise', high: 'completely noise-free, grain-free surfaces and skies', keyword: 'noise free', avoid: 'smooth plastic' },
] as const satisfies readonly ClipartSlider[]

export type ClipartSliderKey = (typeof CLIPART_SLIDERS)[number]['key']
export type ClipartSettings = Record<ClipartSliderKey, number> & { resolution: number }
export const CLIPART_SLIDER_KEYS = CLIPART_SLIDERS.map(slider => slider.key) as ClipartSliderKey[]

export const RESOLUTIONS = [512, 768, 1024, 1280] as const

export const DEFAULT_PROMPT = 'Create an ultra-detailed realistic HD clipart illustration. Preserve the original composition, architecture, objects, signs, and recognizable details. Use realistic textures, clean illustrated edges, natural colors, bright balanced lighting, and professional digital illustration quality.'
export const DEFAULT_NEGATIVE = 'blurry details, distorted architecture, incorrect lettering, cartoonish proportions, oversaturated colors, artificial textures, unwanted objects, composition changes'
export const PROMPT_LIMIT = 1200
export const NEGATIVE_LIMIT = 600

const base: ClipartSettings = {
  overallDetail: 90, fineDetail: 85, textureDetail: 82, architecturalDetail: 88, objectDetail: 85, edgeDefinition: 80,
  photoRealism: 78, realisticTextures: 82, naturalLighting: 80, shadowRealism: 70, materialRealism: 80,
  clipartIntensity: 62, illustrationStrength: 65, outlineDefinition: 35, digitalPainting: 45, cleanEdges: 85,
  vibrance: 60, richness: 60, brightness: 62, contrast: 55, shadowBrightness: 70, highlightBrightness: 55, saturation: 55,
  hdEnhancement: 90, sharpness: 80, clarity: 78, noiseReduction: 80, resolution: 1024,
}

export type ClipartPreset = { id: string; name: string; style: string; sdStyle: string; settings: ClipartSettings }

const preset = (id: string, name: string, style: string, sdStyle: string, changes: Partial<ClipartSettings>): ClipartPreset => ({ id, name, style, sdStyle, settings: { ...base, ...changes } })

export const CLIPART_PRESETS: ClipartPreset[] = [
  preset('realistic-hd', 'Realistic HD Clipart', 'premium realistic HD clipart illustration with photographic detail, clean illustrated edges, rich natural colours and bright, balanced lighting', 'realistic hd clipart illustration', {}),
  preset('defined-photo', 'Defined Photo Clipart (10%)', 'crisp, sharply defined version of the photograph with a light detailed-clipart finish: about 90% photographic and 10% clipart, with tightened edges, cleaner surfaces and slightly more defined shapes', 'crisp defined photo, subtle detailed clipart finish', { clipartIntensity: 10, illustrationStrength: 10, digitalPainting: 5, outlineDefinition: 15, cleanEdges: 85, edgeDefinition: 92, sharpness: 88, clarity: 88, photoRealism: 95, realisticTextures: 92, materialRealism: 92, fineDetail: 90, noiseReduction: 75, vibrance: 55, richness: 55, saturation: 52, contrast: 58, shadowBrightness: 62 }),
  preset('ultra-detailed', 'Ultra Detailed Clipart', 'ultra-detailed clipart illustration where every surface, texture and small object is rendered with obsessive precision', 'ultra detailed clipart illustration', { overallDetail: 100, fineDetail: 100, textureDetail: 95, architecturalDetail: 98, objectDetail: 98, edgeDefinition: 90, sharpness: 88, clarity: 88, clipartIntensity: 70 }),
  preset('photoreal', 'Photorealistic Illustration', 'photorealistic illustration that looks almost like the photograph but is fully repainted with cleaner surfaces and perfect light', 'photorealistic digital illustration', { photoRealism: 95, realisticTextures: 95, materialRealism: 95, shadowRealism: 88, clipartIntensity: 30, illustrationStrength: 40, outlineDefinition: 5, digitalPainting: 30, vibrance: 52, saturation: 50 }),
  preset('pro-digital', 'Professional Digital Illustration', 'professional digital illustration with painterly shading, controlled brushwork and an editorial finish', 'professional digital painting illustration', { digitalPainting: 80, illustrationStrength: 82, clipartIntensity: 55, photoRealism: 60, outlineDefinition: 20, richness: 68 }),
  preset('realistic-3d', 'Realistic 3D Clipart', 'realistic 3D-rendered clipart with modelled, bevelled forms, global illumination and soft ambient occlusion, like a high-end architectural render', 'realistic 3d render clipart, octane render', { materialRealism: 92, shadowRealism: 88, naturalLighting: 88, outlineDefinition: 0, digitalPainting: 15, cleanEdges: 92, clarity: 85, contrast: 60 }),
  preset('vector-realism', 'Clean Vector Realism', 'clean vector-style realistic illustration with crisp shape boundaries, smooth gradients and minimal texture noise', 'clean vector realistic illustration', { textureDetail: 50, realisticTextures: 50, digitalPainting: 10, outlineDefinition: 55, cleanEdges: 100, edgeDefinition: 95, noiseReduction: 95, clipartIntensity: 78, illustrationStrength: 80, photoRealism: 55 }),
  preset('architectural', 'High-Detail Architectural Clipart', 'high-detail architectural clipart illustration, like a professional architectural rendering, with exact geometry, straight verticals and precise facades', 'architectural illustration, detailed building rendering', { architecturalDetail: 100, edgeDefinition: 92, fineDetail: 92, objectDetail: 80, outlineDefinition: 40, materialRealism: 88, cleanEdges: 92 }),
  preset('bright', 'Bright Realistic Clipart', 'bright, cheerful realistic clipart illustration under a clear sunny sky with luminous colour and open, lifted shadows', 'bright sunny realistic clipart illustration', { brightness: 75, shadowBrightness: 82, highlightBrightness: 62, vibrance: 70, saturation: 62, contrast: 52, naturalLighting: 90 }),
  preset('natural-color', 'Natural Color Illustration', 'natural-colour illustration with true-to-life hues, gentle saturation and realistic daylight', 'natural color realistic illustration', { vibrance: 48, richness: 52, saturation: 46, brightness: 55, contrast: 50, shadowBrightness: 62, clipartIntensity: 50, illustrationStrength: 58 }),
  preset('commercial', 'Premium Commercial Clipart', 'premium commercial stock clipart illustration, polished and catalog-ready, with impeccable edges, saturated but tasteful colour and studio-grade clarity', 'premium commercial stock clipart illustration', { clipartIntensity: 80, illustrationStrength: 75, cleanEdges: 98, edgeDefinition: 90, vibrance: 68, richness: 70, saturation: 60, contrast: 62, hdEnhancement: 98, outlineDefinition: 45 }),
]
export const DEFAULT_PRESET_ID = 'realistic-hd'

export const ENGINE_IDS = ['flux-klein-9b', 'flux-klein-4b', 'sd15-img2img', 'gemini'] as const
export type EngineId = (typeof ENGINE_IDS)[number]
export type EngineInfo = { id: EngineId; label: string; provider: 'workers-ai' | 'gemini'; free: boolean; reference: boolean; numeric: boolean; inputEdge: number; resolutions: readonly number[]; concurrency: number; note: string }

export const ENGINES: EngineInfo[] = [
  { id: 'flux-klein-9b', label: 'FLUX.2 klein 9B', provider: 'workers-ai', free: true, reference: true, numeric: false, inputEdge: 496, resolutions: RESOLUTIONS, concurrency: 2, note: 'Free within the daily Workers AI allowance. Best free quality and follows the style reference.' },
  { id: 'flux-klein-4b', label: 'FLUX.2 klein 4B', provider: 'workers-ai', free: true, reference: true, numeric: false, inputEdge: 496, resolutions: RESOLUTIONS, concurrency: 3, note: 'Free within the daily Workers AI allowance. Fastest; follows the style reference.' },
  { id: 'sd15-img2img', label: 'Stable Diffusion 1.5 img2img', provider: 'workers-ai', free: true, reference: false, numeric: true, inputEdge: 1024, resolutions: [512, 768, 1024], concurrency: 3, note: 'Free within the daily Workers AI allowance. Sliders also set strength, guidance and steps; best at 512–768. No style reference.' },
  { id: 'gemini', label: 'Gemini 3.1 Flash Image', provider: 'gemini', free: false, reference: true, numeric: false, inputEdge: 1536, resolutions: [1024, 2048], concurrency: 1, note: 'Uses the site’s Gemini key (billed by Google). Highest fidelity for signs and lettering; follows the style reference.' },
]
export const DEFAULT_ENGINE: EngineId = 'flux-klein-9b'
export const engineInfo = (id: EngineId) => ENGINES.find(engine => engine.id === id) ?? ENGINES[0]

export function closestResolution(engine: EngineInfo, wanted: number) {
  return engine.resolutions.reduce((best, value) => Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best)
}

export function outputSize(width: number, height: number, longEdge: number) {
  const scale = longEdge / Math.max(width, height)
  const round = (value: number) => Math.max(256, Math.round(value * scale / 16) * 16)
  return { width: round(width), height: round(height) }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const tier = (value: number) => value <= 20 ? 'minimal' : value <= 40 ? 'light' : value <= 60 ? 'moderate' : value <= 80 ? 'strong' : 'maximum'

export function sliderInstruction(slider: ClipartSlider, value: number) {
  if (slider.kind === 'balance') {
    const offset = Math.round(value - 50)
    if (Math.abs(offset) < 4) return `${slider.label}: neutral — keep it as in the photograph.`
    return `${slider.label}: ${offset > 0 ? slider.up : slider.down} by about ${Math.abs(offset)}%.`
  }
  const phrase = value < 34 ? slider.low : value <= 66 ? slider.mid : slider.high
  return `${slider.label}: ${tier(value)} (${Math.round(value)}/100) — ${phrase}.`
}

export type PromptInput = { settings: ClipartSettings; preset: ClipartPreset; prompt: string; negative: string; hasReference: boolean }

export function buildPrompt({ settings, preset, prompt, negative, hasReference }: PromptInput) {
  const lines = [
    `Transform ${hasReference ? 'image 0 (the photograph)' : 'the photograph'} into a ${preset.style}.`,
    'Preservation rules (mandatory): keep the exact composition, framing and camera perspective; keep the same subject, buildings, structures, vehicles, trees, grass, roads and objects in the same places and proportions; reproduce signs and lettering with exactly the same words and spelling; do not add, remove or invent any objects; recreate windows, trees, grass, roads, vehicles and architectural details faithfully with improved clarity.',
    settings.clipartIntensity <= 25
      ? `Keep it about ${100 - settings.clipartIntensity}% photographic with only a light detailed-clipart finish (about ${settings.clipartIntensity}%): more defined edges, crisper detail and cleaner surfaces, never a cartoon and never a heavy filter.`
      : 'It must look like detailed professional clipart, not a filtered photograph and not a basic or childish cartoon.',
    'Style controls:',
    ...CLIPART_SLIDERS.map(slider => `- ${sliderInstruction(slider, settings[slider.key])}`),
  ]
  if (hasReference) lines.push('Image 1 is a style reference only: match its colour treatment, illustration style, detail level, lighting, realism and edge quality. Never copy its subject, objects, text or layout into the result.')
  if (prompt.trim()) lines.push(`Additional direction: ${prompt.trim()}`)
  const avoid = [negative.trim(), 'watermarks, borders, frames, added text'].filter(Boolean).join(', ')
  lines.push(`Avoid: ${avoid}.`)
  return lines.join('\n')
}

export function buildCompactPrompt({ settings, preset, prompt, negative }: PromptInput) {
  const ranked = [...CLIPART_SLIDERS].map(slider => {
    const value = settings[slider.key]
    if (slider.kind === 'balance') {
      const offset = value - 50
      return { weight: Math.abs(offset), word: Math.abs(offset) >= 12 ? (offset > 0 ? slider.keywordUp : slider.keywordDown) : '' }
    }
    return { weight: value - 50, word: value >= 60 ? slider.keyword : '' }
  }).filter(item => item.word).sort((a, b) => b.weight - a.weight).map(item => item.word)
  const positive = [preset.sdStyle, prompt.trim().split(/[.\n]/)[0]?.slice(0, 160), ...ranked, 'same composition as the photo'].filter(Boolean).join(', ')
  const avoid = CLIPART_SLIDERS.flatMap(slider => slider.kind === 'level' && 'avoid' in slider && settings[slider.key] <= 25 ? [slider.avoid] : [])
  return { prompt: positive.slice(0, 600), negative: [negative.trim(), 'cartoon, childish, watermark, text artifacts', ...avoid].filter(Boolean).join(', ').slice(0, 600) }
}

export function diffusionParams(settings: ClipartSettings) {
  const style = (settings.clipartIntensity * 0.4 + settings.illustrationStrength * 0.3 + settings.digitalPainting * 0.2 + settings.outlineDefinition * 0.1) / 100
  const realism = (settings.photoRealism * 0.6 + settings.materialRealism * 0.2 + settings.realisticTextures * 0.2) / 100
  const strength = Math.round(clamp(0.3 + style * 0.45 - realism * 0.12, 0.25, 0.8) * 100) / 100
  const guidance = Math.round(clamp(4.5 + (settings.overallDetail + settings.edgeDefinition + settings.sharpness) / 300 * 5, 4, 12) * 2) / 2
  const steps = Math.round(clamp(8 + settings.hdEnhancement / 100 * 8 + settings.clarity / 100 * 4, 6, 20))
  return { strength, guidance, steps }
}

export function normalizeSettings(input: Partial<Record<string, unknown>> | null | undefined, fallback: ClipartSettings = base): ClipartSettings {
  const out = { ...fallback }
  for (const key of CLIPART_SLIDER_KEYS) {
    const value = Number(input?.[key])
    if (Number.isFinite(value)) out[key] = clamp(Math.round(value), 0, 100)
  }
  const resolution = Number(input?.resolution)
  if (Number.isFinite(resolution)) out.resolution = clamp(Math.round(resolution), 256, 2048)
  return out
}

export type SavedPreset = { id: string; name: string; basePreset: string; settings: ClipartSettings; prompt: string; negative: string }
export const SAVED_PRESET_LIMIT = 40
