import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAxiomLists, axiomListMints, axiomListNote, axiomListsOf, axiomListsSchema, axiomListWindowMs, resetAxiomLists } from './axiom-lists.js'
import { trackerState } from './state.js'

const now = 1_800_000_000_000
const mintA = 'D2Zkpv4m8M9Yh7tSDDCtcyZb6WQYVKzkQjM4x5eMQDZB'
const mintB = 'GNphUdE4w3JX9ZtrvpDMnPg2ChWrfBX6BQ6jit5fpump'

test('coins on the Trending and Surge lists are remembered with the list they were seen on', () => {
  resetAxiomLists()
  const taken = applyAxiomLists([
    { list: 'trending', rows: [{ tokenAddress: mintA, userCount: 412, tokenTicker: 'Jojo' }, { tokenAddress: mintB }, { tokenAddress: 'not an address' }, null, 7] },
    { list: 'surge', rows: [{ tokenAddress: mintA, userCount: '420' }] },
  ], now)
  assert.equal(taken, 3)
  assert.deepEqual(axiomListsOf(mintA, now), ['trending', 'surge'])
  assert.deepEqual(axiomListsOf(mintB, now), ['trending'])
  assert.deepEqual(axiomListsOf('other', now), [])
  assert.deepEqual(axiomListMints(now).sort(), [mintA, mintB].sort())
  assert.deepEqual(trackerState.viewers.get(mintA), { count: 420, at: now, source: 'extension' })
  assert.equal(axiomListNote(now + 5_000), ', 2 on Trending, 1 on Surge')
  assert.equal(axiomListNote(now + 60_000), '')
  trackerState.viewers.delete(mintA)
})

test('a coin drops off a list once the bridge has not seen it there for three minutes', () => {
  resetAxiomLists()
  applyAxiomLists([{ list: 'trending', rows: [{ tokenAddress: mintA }, { tokenAddress: mintB }] }], now)
  applyAxiomLists([{ list: 'trending', rows: [{ tokenAddress: mintB }] }, { list: 'surge', rows: [{ tokenAddress: mintA }] }], now + 120_000)
  const later = now + axiomListWindowMs + 1_000
  assert.deepEqual(axiomListsOf(mintA, later), ['surge'])
  assert.deepEqual(axiomListsOf(mintB, later), ['trending'])
  const muchLater = now + 120_000 + axiomListWindowMs + 1_000
  assert.deepEqual(axiomListMints(muchLater), [])
  assert.deepEqual(axiomListsOf(mintA, muchLater), [])
})

test('the report only takes known lists and a bounded number of rows', () => {
  assert.equal(axiomListsSchema.safeParse([{ list: 'trending', rows: [] }]).success, true)
  assert.equal(axiomListsSchema.safeParse([{ list: 'portfolio', rows: [] }]).success, false)
  assert.equal(axiomListsSchema.safeParse([{ list: 'surge', rows: Array.from({ length: 301 }, () => ({})) }]).success, false)
  assert.equal(axiomListsSchema.safeParse([{ list: 'surge', rows: [], extra: 1 }]).success, false)
})
