import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coinSafety, coinSafetyLevel, launchRevokesAuthority } from './axiom-safety.js'

const pumpMint = 'CxGYpWoTun4J3xD4cNwXFRn2W3RzJozTxyU9nbJ4pump'
const otherMint = 'BYKQkHKMWHidNBLQXgt7NX4PLUtJZRYGLWQYkJzPGenX'
const nothingStored = { mint_auth: null, freeze_auth: null, top10_pct: null }

test('pump.fun launches count as revoked without an on-chain read', () => {
  assert.equal(launchRevokesAuthority(pumpMint), true)
  assert.equal(launchRevokesAuthority(otherMint), false)
  assert.deepEqual(coinSafety(pumpMint, nothingStored, 18), { mintAuthority: false, freezeAuthority: false, top10Pct: 18 })
})

test('a pump.fun coin with a spread-out top 10 from Axiom is safe', () => {
  assert.equal(coinSafetyLevel(coinSafety(pumpMint, nothingStored, 18)), 'safe')
})

test('a heavy top 10 from Axiom lowers the level', () => {
  assert.equal(coinSafetyLevel(coinSafety(pumpMint, nothingStored, 90)), 'caution')
  assert.equal(coinSafetyLevel(coinSafety(pumpMint, { mint_auth: 1, freeze_auth: 1, top10_pct: null }, 80)), 'risky')
})

test('a pump.fun coin with no top 10 reading is still rated on its revoked authority', () => {
  assert.equal(coinSafetyLevel(coinSafety(pumpMint, nothingStored, null)), 'safe')
})

test('other launches are never called safe on holders alone', () => {
  assert.equal(coinSafetyLevel(coinSafety(otherMint, nothingStored, 18)), 'caution')
  assert.equal(coinSafetyLevel(coinSafety(otherMint, nothingStored, null)), 'unknown')
})

test('stored on-chain readings win over the launch rule and Axiom', () => {
  assert.deepEqual(coinSafety(pumpMint, { mint_auth: 1, freeze_auth: 0, top10_pct: 25 }, 70), { mintAuthority: true, freezeAuthority: false, top10Pct: 25 })
  assert.equal(coinSafetyLevel(coinSafety(otherMint, { mint_auth: 0, freeze_auth: 0, top10_pct: 20 }, null)), 'safe')
})
