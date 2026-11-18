import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refreshMintFacts } from './chain-holders.js'
import { isSolanaAddress } from './solana-rpc.js'

test('only 32-byte base58 ids count as Solana addresses', () => {
  assert.ok(isSolanaAddress('4KhoLL3YTPUYGeTta8nieEqdJ7CuPzvCjiNYeK8Vpump'))
  assert.ok(isSolanaAddress('So11111111111111111111111111111111111111112'))
  assert.equal(isSolanaAddress('x2ZFJXb1hGSGaMaG96fYSFhE9jkZuPgJp2gYR'), false, 'a list card id of the wrong length')
  assert.equal(isSolanaAddress('0xabc'), false)
  assert.equal(isSolanaAddress(''), false)
})

test('a bad id never reaches the node, so it cannot fail the authority batch for every other coin', async () => {
  const found = await refreshMintFacts(['x2ZFJXb1hGSGaMaG96fYSFhE9jkZuPgJp2gYR', 'not-a-mint'])
  assert.equal(found.size, 0)
})
