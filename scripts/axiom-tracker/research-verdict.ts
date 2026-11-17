import { quickDump, quickDumpMs, type PriceShape } from './price-shape.js'
import type { TraitReading } from './rise-traits.js'

/** A studied coin is negative when any share of supply, read before its peak, is above these. Percentages of supply. */
export const researchLimits = { top10: 35, fresh: 10, dev: 5, bundlers: 25, insiders: 25, snipers: 20, linked: 25 }

/** A dev who has made at least this many coins and graduated under `serialGraduationRate` of them runs a coin factory. */
export const serialLaunches = 20
export const serialGraduationRate = 0.1

/** Real demand during the run: holders grow by half again (to at least `minimumHolders`) and enough different wallets trade it. */
export const organicDemand = { holderGrowth: 1.5, minimumHolders: 100, minimumTraders5m: 50 }

/** A holder with this share of supply or more is a pool or bonding curve, not a wallet. */
export const poolShare = 15

/** Program and exchange accounts that hold many coins and are never anyone's wallet. */
export const sharedAccounts = new Set(['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'])

export type ResearchVerdict = { negatives: string[]; kinds: string[]; topHoldersPct: number | null; freshPct: number | null }

export type VerdictInput = {
  rise: TraitReading
  freshFallback: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
  shape: PriceShape | null
  earlyHolders: number | null
}

/**
 * Judges a coin that grew from what it looked like on the way up. An ordinary dump after the peak is not held against it,
 * because nearly every coin dumps, but two kinds of run are: a pump and dump that falls half below its peak within
 * 15 minutes of its breakout, and the rug pattern of a steady, even climb followed by a steady, even slide. Holder shares
 * are the highest read before its peak, and a coin whose top 10 or fresh-wallet share was never read before then cannot
 * be shown clean, so it is not counted as positive. A positive coin also needs real demand behind its run (growing holders
 * and many different wallets trading) and a dev who is not a serial launcher.
 */
export function judgeResearch(input: VerdictInput): ResearchVerdict {
  const negatives: string[] = []
  const kinds: string[] = []
  const flag = (kind: string, text: string) => { kinds.push(kind); negatives.push(text) }
  const rise = input.rise
  const value = (key: keyof TraitReading) => typeof rise[key] === 'number' ? rise[key] as number : null
  const top10 = value('top10')
  const fresh = value('fresh') ?? input.freshFallback
  const over = (amount: number | null, limit: number, kind: string, label: string) => { if (amount !== null && amount > limit) flag(kind, `${label} ${Math.round(amount)}% of supply before its peak`) }
  over(top10, researchLimits.top10, 'Concentrated holders', 'Top 10 wallets held')
  over(fresh, researchLimits.fresh, 'Fresh wallets', 'Fresh wallets held')
  over(value('dev'), researchLimits.dev, 'Dev heavy', 'The dev held')
  over(value('bundlers'), researchLimits.bundlers, 'Bundled', 'Bundlers held')
  over(value('insiders'), researchLimits.insiders, 'Insider heavy', 'Insiders held')
  over(value('snipers'), researchLimits.snipers, 'Sniped', 'Snipers held')
  over(value('linked'), researchLimits.linked, 'Linked wallets', 'Wallet groups funded together held')
  if (top10 === null) flag('Not checked before its peak', 'Its top 10 holders were not read before its peak')
  if (fresh === null) flag('Not checked before its peak', 'Its fresh wallets were not checked')
  const created = value('devCreated')
  const migrated = value('devMigrated') ?? 0
  if (created !== null && created >= serialLaunches && migrated / created < serialGraduationRate) flag('Serial launcher dev', `The dev had made ${Math.round(created)} coins and only ${Math.round(migrated)} graduated`)
  const holders = value('holders')
  const neededHolders = Math.max(organicDemand.minimumHolders, input.earlyHolders !== null ? Math.ceil(input.earlyHolders * organicDemand.holderGrowth) : 0)
  if (holders !== null && holders < neededHolders) flag('No organic demand', input.earlyHolders !== null ? `Holders only went from ${Math.round(input.earlyHolders)} to ${Math.round(holders)} during its run` : `It had only ${Math.round(holders)} holders at its peak`)
  if (holders === null) flag('Not checked before its peak', 'Its holder count was not read during its run')
  const traders = value('traders')
  if (traders !== null && traders < organicDemand.minimumTraders5m) flag('No organic demand', `At most ${Math.round(traders)} different wallets traded it in any 5 minutes of its run`)
  const shape = input.shape
  if (shape && quickDump(shape)) flag('Pump and dump', `Fell half below its peak ${Math.max(1, Math.round(((shape.dumpAt as number) - shape.runStartAt) / 60_000))} minutes after its breakout began (a pump and dump inside ${quickDumpMs / 60_000} minutes)`)
  if (shape?.steadyRise && shape.steadyFall) flag('Rug pull pattern', 'Climbed in an even, steady line and then slid down in an even, steady line')
  if (input.mintAuthority) flag('Risky token settings', 'Mint authority was still enabled')
  if (input.freezeAuthority) flag('Risky token settings', 'Freeze authority was still enabled')
  return { negatives, kinds: [...new Set(kinds)], topHoldersPct: top10, freshPct: fresh }
}
