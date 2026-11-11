import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CHEERS, TUB_LINES, tubLineAt } from '../systems/Cheers'
import { VOICE_TAGS, clipIdFor, voiceClips } from '../systems/Voice'

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/modules/rackreel/voice/manifest.json'), 'utf8')) as Record<string, string>

test('every line he says is recorded, and nothing else is', () => {
  const ids = voiceClips().map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'clip ids are unique')
  assert.deepEqual([...ids].sort(), Object.keys(manifest).sort())
})

test('he hollers by default and the HUD never shows audio tags', () => {
  for (const clip of voiceClips()) {
    assert.ok(!/\[[a-z ]+\]/i.test(clip.text), `${clip.id} shows no tags`)
    assert.ok(/^\[/.test(clip.spoken), `${clip.id} is read with tags`)
  }
  assert.ok(voiceClips().filter((c) => c.spoken.startsWith(VOICE_TAGS)).length > 50)
})

test('landed carp cycle through the tub lines, each with its own clip', () => {
  assert.equal(TUB_LINES[0], CHEERS.tubbed.line)
  const seen = new Set<string>()
  for (let n = 0; n < TUB_LINES.length; n++) seen.add(tubLineAt(n))
  assert.equal(seen.size, TUB_LINES.length)
  for (const line of TUB_LINES) assert.ok(clipIdFor(line), line)
})
