/** Everything Wisco Wild Man says, renderer-free, with one clip id per line so `scripts/rackreel-voice.mjs` can record him and `game/WildVoice.ts` can play him back. The trip lines live here; cheers and blurts come from `Cheers.ts`. */
import { BLURTS, CHEERS, MISS_LINES, TUB_LINES } from './Cheers'

export const WILD_LINES = {
  board: 'WOOOOO! Watch yer step, bud. Bow\'s up on the deck. Lights are on, let\'s go find some carp.',
  white: 'White light. Best for seein\' \'em.',
  amber: 'Amber cuts through the murk. Fewer bugs too, you betcha.',
  off: 'Lights off. Can\'t shoot what ya can\'t see, bud.',
  over: 'OHH!!! Over the back! Water bends the light. They\'re deeper than they look.',
  under: 'OHH!!! Under \'im! Not quite that low, bud. Ten feet out, four inches under.',
  heading: 'Alrighty, takin\' \'er in. Hang on to somethin\', bud!',
  holdTight: 'Hold tight boys!',
  running: 'Hang on, bud! Woooohooooo!!',
  faster: 'Pushin\' a little quicker. Woooohooooo!!',
  slower: 'Easin\' off.',
  island: 'Over to the island flats. Hang on, bud! Woooohooooo!!',
  shore: 'Back to the shoreline.',
  bay: 'Back bay, under the interstate. Hang on! Woooohooooo!!',
  landed: 'Uff da, what a night. Woooohooooo!!',
  tour: 'Bowfishin\'? You betcha. Grab that bow, bud, sun\'s down by the time we\'re off the launch.',
  wait4: 'Holler at yer buddies, bud. There\'s room for four on this rig. Space when we\'re ready to shove off.',
  /** Said with the trip owner's name in the HUD; the recording says "yer buddy". */
  crew: 'Climb aboard, bud. Yer buddy\'s callin\' the shots tonight.',
} as const

export type WildLineId = keyof typeof WILD_LINES

/** How the recordings are read. */
export const VOICE_STYLE = 'Energetic redneck fishing guide from northern Wisconsin, mid-20s, loud and fired up, thick Upper-Midwest accent, hollering with a big grin like he just saw a monster carp. Fast, punchy delivery; the WOOOOOs are long, full-throated whoops.'

/** ElevenLabs v3 audio tags put in front of every line unless `SPOKEN` reads it another way: he's hollering and hyped nearly all the time. */
export const VOICE_TAGS = '[excited][screaming]'

/** Lines read with their own tags (the quiet ones), keyed by clip id; the HUD still shows the plain text. */
export const SPOKEN: Readonly<Record<string, string>> = {
  'blurt-00': "[whispers] Put the ole sneaky on 'em.",
  'blurt-05': "[whispers] Shhh! Put the ole sneaky on 'em... [excited][screaming] WOOOOO!",
  'tub-01': "[excited][screaming] Get 'em, stink nuts!!! WOOOOO!! [laughs] Hahahaha!",
}

export interface VoiceClip {
  id: string
  text: string
  /** What the recording script sends, audio tags included. */
  spoken: string
}

/** Every line he can say, in a stable order: trip lines, cheers, then blurts. */
export function voiceClips(): VoiceClip[] {
  const clips: VoiceClip[] = []
  const add = (id: string, text: string) => clips.push({ id, text, spoken: SPOKEN[id] ?? `${VOICE_TAGS} ${text}` })
  const nn = (i: number) => String(i).padStart(2, '0')
  for (const [key, text] of Object.entries(WILD_LINES)) add(`line-${key}`, text)
  for (const [key, cheer] of Object.entries(CHEERS)) add(`cheer-${key}`, cheer.line)
  BLURTS.forEach((text, i) => add(`blurt-${nn(i)}`, text))
  MISS_LINES.forEach((text, i) => {
    if (text !== CHEERS.miss.line) add(`miss-${nn(i)}`, text)
  })
  TUB_LINES.forEach((text, i) => {
    if (text !== CHEERS.tubbed.line) add(`tub-${nn(i)}`, text)
  })
  return clips
}

const BY_TEXT = new Map(voiceClips().map((c) => [c.text, c.id]))

/** The clip for a line of his, or null for text that was never recorded. */
export function clipIdFor(text: string): string | null {
  return BY_TEXT.get(text) ?? null
}
