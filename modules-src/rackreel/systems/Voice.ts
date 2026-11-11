/** Everything Wisco Wild Man says, renderer-free, with one clip id per line so `scripts/rackreel-voice.mjs` can record him and `game/WildVoice.ts` can play him back. The trip lines live here; cheers and blurts come from `Cheers.ts`. */
import { BLURTS, CHEERS } from './Cheers'

export const WILD_LINES = {
  board: 'WOOOOO! Watch yer step, bud. Bow\'s up on the deck. Lights are on, let\'s go find some carp.',
  white: 'White light. Best for seein\' \'em.',
  amber: 'Amber cuts through the murk. Fewer bugs too, you betcha.',
  off: 'Lights off. Can\'t shoot what ya can\'t see, bud.',
  over: 'Over the back! Water bends the light. They\'re deeper than they look.',
  under: 'Under \'im! Not quite that low, bud. Ten feet out, four inches under.',
  heading: 'Alrighty, takin\' \'er in. Hang on to somethin\', bud!',
  dawn: 'Sun\'s comin\' up, carp are done.',
  running: 'Hang on, bud!',
  faster: 'Pushin\' a little quicker.',
  slower: 'Easin\' off.',
  island: 'Over to the island flats. Hang on, bud!',
  shore: 'Back to the shoreline.',
  bay: 'Back bay, under the interstate. Hang on!',
  landed: 'Uff da, what a night.',
  tour: 'Bowfishin\'? You betcha. Grab that bow, bud, sun\'s down by the time we\'re off the launch.',
  wait4: 'Holler at yer buddies, bud. There\'s room for four on this rig. Space when we\'re ready to shove off.',
  /** Said with the trip owner's name in the HUD; the recording says "yer buddy". */
  crew: 'Climb aboard, bud. Yer buddy\'s callin\' the shots tonight.',
} as const

export type WildLineId = keyof typeof WILD_LINES

/** How the recordings are read. */
export const VOICE_STYLE = 'Energetic redneck fishing guide from northern Wisconsin, mid-20s, loud and fired up, thick Upper-Midwest accent, hollering with a big grin like he just saw a monster carp. Fast, punchy delivery; the WOOOOOs are long, full-throated whoops.'

export interface VoiceClip {
  id: string
  text: string
}

/** Every line he can say, in a stable order: trip lines, cheers, then blurts. */
export function voiceClips(): VoiceClip[] {
  const clips: VoiceClip[] = []
  for (const [key, text] of Object.entries(WILD_LINES)) clips.push({ id: `line-${key}`, text })
  for (const [key, cheer] of Object.entries(CHEERS)) clips.push({ id: `cheer-${key}`, text: cheer.line })
  BLURTS.forEach((text, i) => clips.push({ id: `blurt-${String(i).padStart(2, '0')}`, text }))
  return clips
}

const BY_TEXT = new Map(voiceClips().map((c) => [c.text, c.id]))

/** The clip for a line of his, or null for text that was never recorded. */
export function clipIdFor(text: string): string | null {
  return BY_TEXT.get(text) ?? null
}
