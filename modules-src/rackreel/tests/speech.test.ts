import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SPEECH_GAP, SpeechQueue } from '../systems/Speech'

test('a line starts at once when he is quiet, and he is busy until it ends', () => {
  const q = new SpeechQueue<string>()
  assert.equal(q.talking(0), false)
  assert.equal(q.quiet(0), Infinity)
  assert.equal(q.offer('board', 10, 4, 2), 'say')
  assert.equal(q.talking(10), true)
  assert.equal(q.talking(13.9), true)
  assert.equal(q.quiet(12), 0)
  assert.equal(q.talking(14 + SPEECH_GAP + 0.01), false)
  assert.ok(Math.abs(q.quiet(20) - (6 - SPEECH_GAP)) < 1e-9)
  assert.equal(q.next(20), null, 'nothing was held')
})

test('a line offered while he talks waits for him to finish, then is said once', () => {
  const q = new SpeechQueue<string>()
  q.offer('running', 0, 3, 2)
  assert.equal(q.offer('stoned', 1.5, 2, 2), 'hold')
  assert.equal(q.next(2), null, 'still mid-line')
  assert.equal(q.next(2.9), null)
  const at = 3 + SPEECH_GAP + 0.01
  assert.equal(q.next(at), 'stoned')
  assert.equal(q.talking(at + 1.9), true, 'now he is saying the held line')
  assert.equal(q.next(at + 0.1), null, 'said once')
  assert.equal(q.next(at + 5), null)
})

test('a line that could not start in time is skipped, never said late', () => {
  const q = new SpeechQueue<string>()
  q.offer('board', 0, 10, 6)
  assert.equal(q.offer('stoned', 2, 2, 2.5), 'skip', 'eight seconds left, two and a half of patience')
  assert.equal(q.next(10.5), null)
  q.offer('under', 20, 4, 2)
  assert.equal(q.offer('tubbed', 22, 1, 2.5), 'hold')
  assert.equal(q.next(40), null, 'the frame loop stalled past its patience')
  assert.equal(q.talking(40), false)
})

test('blurts never wait and he never repeats the line he is saying', () => {
  const q = new SpeechQueue<string>()
  q.offer('faster', 0, 3, 2)
  assert.equal(q.offer('blurt', 2.5, 3, 0), 'skip')
  assert.equal(q.offer('faster', 2.5, 3, 2), 'skip', 'already saying it')
  assert.equal(q.next(4), null)
  assert.equal(q.offer('blurt', 4, 3, 0), 'say', 'free again')
})

test('only the newest waiting line is kept', () => {
  const q = new SpeechQueue<string>()
  q.offer('island', 0, 3, 2)
  assert.equal(q.offer('amber', 1.5, 2, 2), 'hold')
  assert.equal(q.offer('off', 2, 2, 2), 'hold')
  assert.equal(q.offer('blurt', 2.2, 2, 0), 'skip', 'a blurt does not push a waiting line out')
  assert.equal(q.next(3.5), 'off')
  assert.equal(q.next(6), null)
})

test('a line that comes up after he finished goes first and drops the one still waiting', () => {
  const q = new SpeechQueue<string>()
  q.offer('island', 0, 3, 2)
  q.offer('amber', 2, 2, 2)
  assert.equal(q.offer('stoned', 3.5, 2, 2), 'say')
  assert.equal(q.next(3.6), null)
  assert.equal(q.next(6), null)
})

test('reset forgets the line in progress and the one waiting', () => {
  const q = new SpeechQueue<string>()
  q.offer('island', 0, 3, 2)
  q.offer('amber', 2, 2, 2)
  q.reset()
  assert.equal(q.talking(1), false)
  assert.equal(q.next(4), null)
})

test('whatever comes up and whenever, two lines never overlap', () => {
  let seed = 12345
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let run = 0; run < 40; run++) {
    const q = new SpeechQueue<number>()
    const spans: [number, number][] = []
    const lengths = new Map<number, number>()
    let id = 0
    for (let t = 0; t < 120; t += 1 / 30) {
      const started = q.next(t)
      if (started !== null) spans.push([t, t + lengths.get(started)!])
      if (rand() < 0.03) {
        const seconds = 1 + rand() * 9
        const line = rand() < 0.2 && id > 0 ? id - 1 : id++
        if (!lengths.has(line)) lengths.set(line, seconds)
        if (q.offer(line, t, lengths.get(line)!, rand() < 0.3 ? 0 : 1 + rand() * 5) === 'say') spans.push([t, t + lengths.get(line)!])
      }
    }
    assert.ok(spans.length > 5)
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] + SPEECH_GAP - 1e-9, `run ${run}: line ${i} starts at ${spans[i][0]} before the last one ends at ${spans[i - 1][1]}`)
  }
})
