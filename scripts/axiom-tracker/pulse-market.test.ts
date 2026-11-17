import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noteDexMarket, notePulseFlow, pairFromPulse, pulseFlow5m, pulseHoldMs, pulseIdentity, resetPulseHold, withPulseMarket } from './pulse-market.js'
import { parsePulseCard } from './pulse-cards.js'
import { trackerState } from './state.js'
import { geckoAnswered, geckoGapMs, geckoLimited, geckoPacing, geckoReady, resetGeckoPacing } from './gecko-limit.js'
import type { MarketReading } from './dexscreener.js'

const now = 1_800_000_000_000
const lines = ['0 SOL', 'V', '$33K', 'MC', '$10.9K', 'F', '3.177', 'TX', '651', '8DBs...pump', 'ALT', 'Altcoin', '2%', '36m', '71', '60/1430', '51', '24%', 'DS', '0%', '4%', '27%']

test('a Pulse card gives the ticker, name and launch time', () => {
  const identity = pulseIdentity(lines, null, now)
  assert.equal(identity?.symbol, 'ALT')
  assert.equal(identity?.name, 'Altcoin')
  assert.equal(identity?.createdAt, now - 36 * 60_000)
})

test('five-minute volume comes from the running totals on the card', () => {
  const mint = 'Flow1111111111111111111111111111111111pump'
  for (let second = 0; second <= 120; second += 10) notePulseFlow(mint, { ...parsePulseCard(lines, 51, now + second * 1_000), volume: 30_000 + second * 50, txCount: 600 + second })
  const flow = pulseFlow5m(mint, now + 120_000, now - 36 * 60_000)
  assert.ok(flow && Math.abs(flow.volume - 15_000) < 1, JSON.stringify(flow))
  assert.equal(flow?.txns, 300)
})

test('a card that goes quiet keeps its price until DexScreener publishes something newer', () => {
  resetPulseHold()
  const mint = 'Hold1111111111111111111111111111111111pump'
  trackerState.pulseCards.set(mint, parsePulseCard(lines, 51, now))
  const dex: MarketReading = { mint, pairAddress: 'pair', priceUsd: 0.000005, marketCap: 5_000, liquidityUsd: 5_000, volume5m: 1_000, buys5m: 10, sells5m: 5, pairCreatedAt: now - 60_000, readAt: now - 20_000 }
  noteDexMarket(mint, dex)
  const fresh = withPulseMarket(mint, dex, now + 1_000)
  assert.equal(fresh?.marketCap, 10_900)
  const quiet = withPulseMarket(mint, dex, now + 12_000)
  assert.equal(quiet?.marketCap, 10_900, 'DexScreener still shows what it showed before the card moved')
  assert.ok(Math.abs((quiet?.priceUsd ?? 0) - 0.0000109) < 1e-12)
  assert.equal(quiet?.readAt, now)
  assert.equal(withPulseMarket(mint, quiet, now + 13_000), quiet, 'a reading already carrying the card figure is left alone')
  const newer: MarketReading = { ...dex, priceUsd: 0.000012, marketCap: 12_000, readAt: now + 20_000 }
  noteDexMarket(mint, newer)
  assert.equal(withPulseMarket(mint, newer, now + 21_000), newer)
  assert.equal(withPulseMarket(mint, dex, now + 22_000), dex, 'the hold ended when DexScreener moved')
  trackerState.pulseCards.set(mint, parsePulseCard(lines, 51, now + 30_000))
  noteDexMarket(mint, dex)
  withPulseMarket(mint, dex, now + 31_000)
  assert.equal(withPulseMarket(mint, dex, now + 30_000 + pulseHoldMs + 1_000), dex, 'a card price is not kept past the hold')
  trackerState.pulseCards.delete(mint)
  resetPulseHold()
})

test('a fresh card moves the price with Axiom market cap, and a coin DexScreener lacks is followed from its card', () => {
  const mint = 'Card1111111111111111111111111111111111pump'
  const card = parsePulseCard(lines, 51, now)
  trackerState.pulseCards.set(mint, card)
  trackerState.pulseNames.set(mint, { ...(pulseIdentity(lines, null, now) as NonNullable<ReturnType<typeof pulseIdentity>>) })
  const dex: MarketReading = { mint, pairAddress: 'pair', priceUsd: 0.00001, marketCap: 10_000, liquidityUsd: 5_000, volume5m: 1_000, buys5m: 10, sells5m: 5, pairCreatedAt: now - 60_000, readAt: now - 15_000 }
  const live = withPulseMarket(mint, dex, now + 1_000)
  assert.equal(live?.marketCap, 10_900)
  assert.ok(Math.abs((live?.priceUsd ?? 0) - 0.0000109) < 1e-12)
  assert.equal(withPulseMarket(mint, dex, now + 10_000), dex)
  const pair = pairFromPulse(mint, now + 1_000)
  assert.equal(pair?.baseToken.symbol, 'ALT')
  assert.equal(pair?.pairAddress, mint)
  assert.equal(pair?.marketCap, 10_900)
  trackerState.pulseCards.delete(mint)
  trackerState.pulseNames.delete(mint)
})

test('GeckoTerminal pacing widens after a limit answer and eases back after good ones', () => {
  resetGeckoPacing()
  const start = geckoGapMs()
  geckoLimited(now)
  assert.ok(geckoGapMs() > start)
  assert.equal(geckoReady(now + 1_000), false)
  assert.equal(geckoReady(now + geckoPacing.coolDownMs + geckoGapMs()), true)
  const widened = geckoGapMs()
  for (let index = 0; index < geckoPacing.easeAfter; index++) geckoAnswered()
  assert.ok(geckoGapMs() < widened)
  resetGeckoPacing()
})

test('every coin in the Pulse worker feed becomes a Pulse coin with dollar figures and holder shares', async () => {
  const { applyPulseFeed, pulseFeedSchema } = await import('./pulse-feed.js')
  const mint = 'Feed1111111111111111111111111111111111pump'
  const feed = pulseFeedSchema.parse({
    usdPerSol: 70,
    rows: [{ column: 'newPairs', pairAddress: '8joWpsrzJRYibU3Cp5hezATASCDRAGN4sJxe5QhmD4BX', tokenAddress: mint, tokenName: 'Feed Coin', tokenTicker: 'FEED', createdAt: new Date(now - 120_000).toISOString(), marketCap: 200, volume: '50', liquidityNative: '20', numHolders: 140, userCount: 44, numTxns: 300, numBuys: 210, numSells: 90, top10HoldersPercent: 18.5, devHoldsPercent: 0, devSold: true, bundlersHoldPercent: 4, freshWalletsHoldPercent: 3, proTradersHoldPercent: 12, swapParams: [3, '1', '2'] }],
  })
  assert.equal(applyPulseFeed(feed, now), 1)
  const card = trackerState.pulseCards.get(mint)
  assert.equal(card?.marketCap, 14_000)
  assert.equal(card?.volume, 3_500)
  assert.equal(card?.liquidityUsd, 2_800)
  assert.equal(card?.freshPct, 3)
  assert.equal(card?.devPct, 0)
  assert.equal(trackerState.pulseNames.get(mint)?.symbol, 'FEED')
  assert.equal(trackerState.pulseNames.get(mint)?.createdAt, now - 120_000)
  assert.equal(trackerState.viewers.get(mint)?.count, 44)
  assert.ok(trackerState.pulse.has(mint))
  const market = withPulseMarket(mint, null, now)
  assert.equal(market?.buys5m, 210)
  assert.equal(market?.liquidityUsd, 2_800)
  for (const map of [trackerState.pulseCards, trackerState.pulseNames, trackerState.viewers, trackerState.pulse]) map.delete(mint)
})

test('a coin with a field the tracker cannot read is skipped, not the whole Pulse feed', async () => {
  const { applyPulseFeed, pulseFeedSchema, pulseFeedSeen } = await import('./pulse-feed.js')
  const good = 'Good1111111111111111111111111111111111pump'
  const feed = pulseFeedSchema.parse({ usdPerSol: 70, rows: [
    { column: 'migrated', pairAddress: '8joWpsrzJRYibU3Cp5hezATASCDRAGN4sJxe5QhmD4BX', tokenAddress: good, tokenTicker: 'OK', createdAt: {}, marketCap: 100, userCount: 5 },
    { column: 'migrated', pairAddress: 'not-an-address', tokenAddress: 'nope' },
  ] })
  assert.equal(applyPulseFeed(feed, now), 1)
  assert.equal(pulseFeedSeen.skipped, 1)
  assert.equal(trackerState.pulseNames.get(good)?.createdAt, null)
  for (const map of [trackerState.pulseCards, trackerState.pulseNames, trackerState.viewers, trackerState.pulse]) map.delete(good)
})
