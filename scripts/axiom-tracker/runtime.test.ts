import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abandonIfHung, fetchJson } from './runtime.js'

const never = () => new Promise<never>(() => { })

test('a step that never settles is abandoned after its limit', async () => {
  const started = Date.now()
  await assert.rejects(abandonIfHung('site upload', 40, never), /site upload hung for 0s and was abandoned/)
  assert.ok(Date.now() - started < 1_000)
})

test('a step that settles in time passes its result or its error through', async () => {
  assert.equal(await abandonIfHung('scoring', 1_000, async () => 7), 7)
  await assert.rejects(abandonIfHung('scoring', 1_000, async () => { throw new Error('HTTP 500') }), /HTTP 500/)
})

test('fetchJson gives up on a request that ignores its timeout', async t => {
  t.mock.method(globalThis, 'fetch', never)
  await assert.rejects(fetchJson('https://tracker.invalid/prices', { timeoutMs: 30, retries: 0 }), /hung/)
})

test('fetchJson gives up on a reply whose body never arrives', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: never }))
  await assert.rejects(fetchJson('https://tracker.invalid/prices', { timeoutMs: 30, retries: 0 }), /hung/)
})

test('fetchJson retries after a hung request and returns the next answer', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', () => {
    calls += 1
    return calls === 1 ? never() : Promise.resolve({ ok: true, status: 200, json: async () => ({ price: 2 }) })
  })
  assert.deepEqual(await fetchJson('https://tracker.invalid/prices', { timeoutMs: 30, retries: 1 }), { price: 2 })
  assert.equal(calls, 2)
})

test('the site upload steps down from details to the slim payload until it fits, measured in bytes', async () => {
  const { fitBody } = await import('./site-publisher.js')
  const big = { text: 'é'.repeat(600) }
  const small = { text: 'ok' }
  assert.equal(fitBody([() => big, () => small], 1_000), JSON.stringify(small))
  assert.equal(fitBody([() => ({ text: 'a'.repeat(900) })], 1_000), JSON.stringify({ text: 'a'.repeat(900) }))
  assert.equal(fitBody([() => big], 1_000), null)
})

test('the slim payload keeps score ledgers only for the top-scored coins', async () => {
  const { slimPayload } = await import('./site-publisher.js')
  const coin = (mint: string, score: number) => ({ mint, score, history: [], scoreLedger: { score }, spark: { fast: [1], slow: [1] }, scoreTrail: null })
  const slim = slimPayload({ tokens: [coin('a', 10), coin('b', 90), coin('c', 50)] } as never, 2)
  const ledgers = Object.fromEntries(slim.tokens.map(token => [token.mint, Boolean(token.scoreLedger)]))
  assert.deepEqual(ledgers, { a: false, b: true, c: true })
})
