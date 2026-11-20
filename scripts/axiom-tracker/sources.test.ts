import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedHost, axiomOnly } from './sources.js'

test('Axiom-only mode is the default and blocks outside sites', () => {
  assert.equal(axiomOnly, true)
  assert.equal(allowedHost('https://api.dexscreener.com/tokens/v1/solana/x'), false)
  assert.equal(allowedHost('https://api.geckoterminal.com/api/v2'), false)
  assert.equal(allowedHost('https://lite-api.jup.ag/tokens/v2'), false)
  assert.equal(allowedHost('https://api.mainnet-beta.solana.com'), false)
  assert.equal(allowedHost('https://mainnet.helius-rpc.com/?api-key=x'), false)
})

test('Axiom, this PC and the site stay reachable', () => {
  assert.equal(allowedHost('https://api.axiom.trade/x'), true)
  assert.equal(allowedHost('https://axiom.trade/meme/x'), true)
  assert.equal(allowedHost('http://127.0.0.1:8791/live'), true)
  assert.equal(allowedHost('https://thelibrary.garrdetto.workers.dev/api/admin/axiom/ingest'), true)
  assert.equal(allowedHost('https://example.org/x', 'https://example.org'), true)
  assert.equal(allowedHost('not a url'), false)
})
