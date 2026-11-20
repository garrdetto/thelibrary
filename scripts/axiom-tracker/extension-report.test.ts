import assert from 'node:assert/strict'
import { test } from 'node:test'
import { report } from './extension-intake.js'

const mint = 'So11111111111111111111111111111111111111112'
const base = { url: 'https://axiom.trade/pulse', pairAddress: null, pageViewers: null, frames: [] }
const pulse = { usdPerSol: 69.1, rows: [{ tokenAddress: mint }] }

test('a card with a long coin name no longer throws away the Pulse feed', () => {
  const long = 'BATHROOM BATHROOM LIVE UNTIL 10M MC AND THEN SOME MORE WORDS THAT RUN PAST SIXTY'
  const parsed = report.safeParse({ ...base, cards: [{ viewers: 3, pairAddress: null, mint, short: null, lines: [long] }], pulse })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data?.pulse?.rows.length, 1)
  assert.equal(parsed.data?.cards[0]?.lines?.[0]?.length, 60)
})

test('one unreadable card or section is dropped on its own', () => {
  const parsed = report.safeParse({ ...base, cards: [{ viewers: -1, pairAddress: null, mint, short: null }, { viewers: 2, pairAddress: null, mint, short: null }], stats: { x: 500 }, pulse, newField: true })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data?.cards.length, 1)
  assert.equal(parsed.data?.stats, undefined)
  assert.equal(parsed.data?.pulse?.usdPerSol, 69.1)
})
