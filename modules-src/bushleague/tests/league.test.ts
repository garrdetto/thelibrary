import assert from 'node:assert/strict'
import { availableParallelism } from 'node:os'
import { test } from 'node:test'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { emptyTotals, mergeTotals, simulateLeague, summarize, type LeagueTotals } from '../sim'

const CONTESTS = 10_000
const SEED = 20261105

if (!isMainThread) {
  const { start, count } = workerData as { start: number; count: number }
  parentPort!.postMessage(simulateLeague(count, SEED, start))
} else {
  test(`league calibration over ${CONTESTS.toLocaleString()} AI-vs-AI contests`, { timeout: 900_000 }, async () => {
    const workers = Math.max(1, Math.min(16, availableParallelism() - 1))
    const chunk = Math.ceil(CONTESTS / workers)
    const parts = await Promise.all(
      Array.from({ length: workers }, (_, index) => {
        const start = index * chunk
        const count = Math.max(0, Math.min(chunk, CONTESTS - start))
        return new Promise<LeagueTotals>((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: { start, count } })
          worker.once('message', resolve)
          worker.once('error', reject)
        })
      }),
    )
    const totals = parts.reduce((all, part) => mergeTotals(all, part), emptyTotals())
    assert.equal(totals.contests, CONTESTS)
    const league = summarize(totals)
    const report = `AVG ${league.avg.toFixed(3)}, R/9 ${league.runsPerNine.toFixed(2)}, HR/FB ${(league.hrPerFly * 100).toFixed(1)}%, K ${(league.kRate * 100).toFixed(1)}%, BB ${(league.bbRate * 100).toFixed(1)}%, BABIP ${league.babip.toFixed(3)}`
    console.log(report)
    assert.ok(league.avg >= 0.24 && league.avg <= 0.26, `batting average out of range: ${report}`)
    assert.ok(league.runsPerNine >= 4.0 && league.runsPerNine <= 5.0, `runs per nine out of range: ${report}`)
    assert.ok(league.hrPerFly >= 0.1 && league.hrPerFly <= 0.14, `HR/FB out of range: ${report}`)
    assert.ok(league.kRate >= 0.17 && league.kRate <= 0.26, `strikeout rate out of range: ${report}`)
    assert.ok(league.bbRate >= 0.06 && league.bbRate <= 0.11, `walk rate out of range: ${report}`)
  })
}
