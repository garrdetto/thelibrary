/** The Gutter Report: seeded, silly headlines from around the Bush Leagues plus live notes from this contest. Deterministic per seed so a rematch reads the same wire. */
import { Rng, TEAMS, nickname, parkById, type Contest, type Team } from '../sim'

const TEMPLATES: readonly ((a: Team, b: Team, rng: Rng) => string)[] = [
  (a, b) => `${a.city} ${a.name} edge the ${b.name} after a seventh-inning hot dog delay`,
  (a) => `${a.name} manager fined for arguing a call with the mascot`,
  (a, _b, rng) => `${a.city} reliever "${nickname(rng)}" activated from the 15-day nap list`,
  (a) => `Concession stand at ${a.parkName} sells out of nachos by the second inning`,
  (a, b) => `${a.name} and ${b.name} combine for zero walks, league officials request a recount`,
  (a) => `${a.city} shortstop's lucky socks reach 40 straight contests unwashed`,
  (a, b) => `Rain delay in ${a.city}: the ${b.name} use the tarp as a slip-and-slide`,
  (a) => `${a.name} promotion night: free mullets for the first 500 fans`,
  (a, _b, rng) => `${a.city} pitcher throws a ${rng.int(42, 58)} mph knuckleball, batter still waiting`,
  (a) => `Organist at ${a.parkName} plays "Charge" 112 times, sets a league record`,
  (a, b) => `Trade rumor: the ${a.name} offer two bags of sunflower seeds for a ${b.name} utility man`,
  (a) => `${a.city} fans vote the foul pole their most valuable player`,
]

export function tickerHeadlines(contest: Contest, count = 8): string[] {
  const rng = new Rng(contest.setup.seed * 31 + 7)
  const lines: string[] = []
  for (let index = 0; index < count; index++) {
    const a = rng.pick(TEAMS)
    let b = rng.pick(TEAMS)
    while (b.id === a.id) b = rng.pick(TEAMS)
    lines.push(rng.pick(TEMPLATES)(a, b, rng))
  }
  const park = parkById(contest.park.id)
  const away = contest.teams[0].roster.team
  const home = contest.teams[1].roster.team
  const wind = contest.wind.speed < 1 ? 'no wind to speak of' : `wind ${Math.round(contest.wind.speed * 2.237)} mph ${Math.abs(((contest.wind.toward % 360) + 540) % 360 - 180) < 40 ? 'blowing in' : Math.abs(contest.wind.toward) < 40 ? 'blowing out' : 'across the field'}`
  lines.splice(2, 0, `Tonight: ${away.city} ${away.name} at ${home.city} ${home.name}, ${home.parkName}, ${park.altitude} m up, ${park.dome ? 'under the dome' : wind}`)
  return lines
}

export function liveNote(contest: Contest): string | null {
  const last = contest.plays[contest.plays.length - 1]
  if (!last) return null
  return `${last.half === 'top' ? 'Top' : 'Bottom'} ${last.inning}: ${last.text}`
}
