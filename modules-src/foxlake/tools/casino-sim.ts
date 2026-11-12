/**
 * Simulates every machine to check its return and feature frequency.
 *
 *   node scripts/casino-sim.mjs [spins]
 *
 * Prints the return at the machine's current `scale`, the base-game share,
 * how often each feature starts and what it pays on average (in bets), the
 * biggest win seen, and the `scale` that would return 94%.
 */
import { MACHINES, playSpin, type MachineState } from '../casino/math/machines'
import { seededRng } from '../casino/math/rng'

declare const process: { argv: string[] }

const N = Number(process.argv[2] ?? 100000)
for (const def of MACHINES) {
  const rng = seededRng(99)
  let paid = 0
  let base = 0
  let max = 0
  let state: MachineState = {}
  const feats: Record<string, number> = {}
  const featWin: Record<string, number> = {}
  const t0 = Date.now()
  for (let i = 0; i < N; i++) {
    const r = playSpin(def, 1, rng, state)
    state = r.state
    paid += r.totalWin
    base += r.base.win
    max = Math.max(max, r.totalWin)
    if (r.feature) {
      feats[r.feature.kind] = (feats[r.feature.kind] ?? 0) + 1
      featWin[r.feature.kind] = (featWin[r.feature.kind] ?? 0) + r.feature.win
    }
  }
  const rtp = paid / N
  const f = Object.entries(feats).map(([k, n]) => `${k} 1/${Math.round(N / n)} avg ${(featWin[k] / n).toFixed(1)}x`).join(', ')
  console.log(`${def.id.padEnd(26)} rtp ${rtp.toFixed(3)} base ${(base / N).toFixed(3)} max ${max.toFixed(0)}x scale ${def.scale} -> ${((0.94 * def.scale) / rtp).toFixed(3)} | ${f} | ${Date.now() - t0} ms`)
}
