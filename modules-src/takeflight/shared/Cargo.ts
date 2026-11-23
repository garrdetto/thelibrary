/**
 * The cargo career's contracts. Each day (UTC) offers the same eight contracts to everyone, generated from the day number: an
 * origin and a destination airport, a load in kilograms of some named goods, and the pay. A contract is delivered by landing on a
 * runway at the destination without a crash; the pay then scales from 60 % to 100 % with the flight's score. Contracts stay open
 * for the day they were offered and the next. Pure and exact, so the Worker regenerates a contract from its id and pays it itself.
 */
import { AIRPORTS, airportById } from './Airports'
import { SimRandom } from '../sim/SimMath'

export interface CargoJob {
  id: string
  day: number
  from: string
  to: string
  goods: string
  kg: number
  /** Great-circle-free straight distance, km. */
  km: number
  /** Full pay for a perfect delivery. */
  pay: number
}

const JOBS_PER_DAY = 8
const DAY_MS = 86400000
const GOODS = ['machine parts', 'medical supplies', 'mail', 'farm equipment', 'electronics', 'spare engines', 'fresh produce', 'textiles', 'tools', 'survey gear', 'printed books', 'office furniture']
const LOADS = [180, 260, 340, 420, 520, 650, 800, 950, 1200, 1500, 1800, 2200]

export function dayNumber(now: number): number {
  return Math.floor(now / DAY_MS)
}

function distanceKm(from: string, to: string): number {
  const a = airportById(from)
  const b = airportById(to)
  if (!a || !b) return 0
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.round(Math.sqrt(dx * dx + dz * dz) / 100) / 10
}

/** The contracts offered on `day`. */
export function jobsFor(day: number): CargoJob[] {
  const random = new SimRandom((day * 2654435761) | 1)
  const jobs: CargoJob[] = []
  for (let i = 0; i < JOBS_PER_DAY; i++) {
    const from = AIRPORTS[Math.floor(random.next() * AIRPORTS.length)].id
    let to = from
    while (to === from) to = AIRPORTS[Math.floor(random.next() * AIRPORTS.length)].id
    const kg = LOADS[Math.floor(random.next() * LOADS.length)]
    const goods = GOODS[Math.floor(random.next() * GOODS.length)]
    const km = distanceKm(from, to)
    const pay = Math.round((120 + km * 9 + kg * 0.35 + km * kg * 0.004) / 5) * 5
    jobs.push({ id: `d${day}-${i}`, day, from, to, goods, kg, km, pay })
  }
  return jobs
}

/** The contract with this id if it is still open at `now` (offered today or yesterday). */
export function openJob(id: string, now: number): CargoJob | null {
  const match = /^d(\d+)-(\d)$/.exec(id)
  if (!match) return null
  const day = Number(match[1])
  const today = dayNumber(now)
  if (day !== today && day !== today - 1) return null
  return jobsFor(day)[Number(match[2])] ?? null
}

/** Pay for a flight flown on `job`: 60–100 % of the contract with the score, or 0 unless it landed on a runway at the destination. */
export function cargoPay(job: CargoJob, delivery: { crashed: boolean; total: number; landedAt: string | null; onRunway: boolean }): number {
  if (delivery.crashed || !delivery.onRunway || delivery.landedAt !== job.to) return 0
  const share = 0.6 + 0.4 * Math.max(0, Math.min(100, delivery.total)) / 100
  return Math.round(job.pay * share)
}
