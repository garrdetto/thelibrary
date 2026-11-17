import { clubInfo, clubLabel } from './clubs'
import { fmt, signed, type ClubSummary } from './stats'

export type TipLevel = 'focus' | 'watch' | 'strength'

export type DataTip = {
  id: string
  club: string | null
  level: TipLevel
  title: string
  detail: string
  drill?: string
  articleId?: string
}

export const MIN_SHOTS = 5

type Window = { launch: [number, number]; spin: [number, number] }

/** Rough optimal driver windows by ball speed (mph), in the spirit of published launch-monitor charts. */
export function driverWindow(ballSpeed: number): Window {
  if (ballSpeed < 120) return { launch: [15, 19], spin: [2600, 3300] }
  if (ballSpeed < 140) return { launch: [13.5, 17], spin: [2400, 3000] }
  if (ballSpeed < 160) return { launch: [12, 16], spin: [2100, 2800] }
  return { launch: [10.5, 14.5], spin: [1800, 2600] }
}

export function smashTarget(code: string | null) {
  const info = clubInfo(code)
  if (!info) return 1.3
  if (info.kind === 'driver') return 1.45
  if (info.kind === 'wood') return 1.42
  if (info.kind === 'hybrid') return 1.38
  if (info.kind === 'wedge') return 1.18
  if (info.kind === 'iron') return Math.max(1.24, 1.42 - (info.loft - 18) * 0.0075)
  return 1.3
}

function ironNumber(code: string | null) {
  const match = code?.match(/^(\d)I$/)
  return match ? Number(match[1]) : null
}

export function clubTips(summary: ClubSummary): DataTip[] {
  const tips: DataTip[] = []
  const club = summary.club
  const name = clubLabel(club)
  const kind = clubInfo(club)?.kind
  const id = (key: string) => `${club ?? 'unknown'}:${key}`
  if (summary.shots < MIN_SHOTS) return tips
  const add = (tip: Omit<DataTip, 'club' | 'id'> & { key: string }) => tips.push({ id: id(tip.key), club, level: tip.level, title: tip.title, detail: tip.detail, drill: tip.drill, articleId: tip.articleId })

  const smash = summary.smash
  if (smash && smash.n >= MIN_SHOTS) {
    const target = smashTarget(club)
    if (smash.mean < target - 0.05) add({ key: 'smash', level: 'focus', title: `${name}: strike is costing ball speed`, detail: `Smash factor averages ${fmt(smash.mean, 2)}, against about ${fmt(target, 2)} for a centred ${name.toLowerCase()} strike. That gap is roughly ${fmt((target - smash.mean) * (summary.clubSpeed?.mean ?? 0), 0)} mph of ball speed left on the table.`, drill: 'Spray foot powder or a dry-erase marker on the face and hit ten balls, chasing a mark in the centre rather than speed.', articleId: 'strike' })
    else if (smash.mean >= target - 0.01) add({ key: 'smash-good', level: 'strength', title: `${name}: centred contact`, detail: `Smash factor ${fmt(smash.mean, 2)} is at or above the ${fmt(target, 2)} you would expect from this club.` })
  }

  const launch = summary.launch
  const spin = summary.spin
  if (kind === 'driver' && launch && spin && summary.ballSpeed) {
    const window = driverWindow(summary.ballSpeed.mean)
    const low = launch.mean < window.launch[0]
    const high = launch.mean > window.launch[1]
    const spinHigh = spin.mean > window.spin[1]
    const spinLow = spin.mean < window.spin[0]
    if (low || high || spinHigh || spinLow) {
      const parts = [low ? `launch is low (${fmt(launch.mean)}°)` : high ? `launch is high (${fmt(launch.mean)}°)` : null, spinHigh ? `spin is high (${fmt(spin.mean, 0)} rpm)` : spinLow ? `spin is low (${fmt(spin.mean, 0)} rpm)` : null].filter(Boolean)
      add({ key: 'window', level: 'focus', title: 'Driver: outside the launch window', detail: `At ${fmt(summary.ballSpeed.mean, 0)} mph ball speed the sweet spot is about ${window.launch[0]}–${window.launch[1]}° launch with ${window.spin[0]}–${window.spin[1]} rpm. Your ${parts.join(' and ')}. ${spinHigh || low ? 'Hitting up on the ball and striking slightly higher on the face both raise launch and cut spin.' : 'Low spin with a high launch can fall out of the sky; check the strike is not high on the face.'}`, drill: 'Tee it so half the ball sits above the crown, move the ball up to the lead heel, and tilt your spine away from the target at address.', articleId: 'driver-window' })
    } else add({ key: 'window-good', level: 'strength', title: 'Driver: in the launch window', detail: `${fmt(launch.mean)}° launch and ${fmt(spin.mean, 0)} rpm suit your ${fmt(summary.ballSpeed.mean, 0)} mph ball speed.` })
  }

  const aoa = summary.attackAngle
  if (aoa && aoa.n >= MIN_SHOTS) {
    if (kind === 'driver' && aoa.mean < -1) add({ key: 'aoa', level: 'focus', title: 'Driver: hitting down on it', detail: `Attack angle averages ${signed(aoa.mean)}°. Going from −3° to +3° typically adds 10–15 yards at the same club speed, because launch rises while spin falls.`, drill: 'Put a headcover a grip-length behind the ball on the target line and miss it on the way down.', articleId: 'attack-angle' })
    if ((kind === 'iron' || kind === 'wedge') && aoa.mean > -1) add({ key: 'aoa', level: 'focus', title: `${name}: not hitting down`, detail: `Attack angle averages ${signed(aoa.mean)}°. Good iron contact is usually 3–6° down, ball first, which keeps spin and launch consistent.`, drill: 'Draw a line on a mat or lay a towel 4 inches behind the ball and make divots (or brush the mat) after the line.', articleId: 'attack-angle' })
  }

  const number = ironNumber(club)
  if (number && spin) {
    const expected = number * 1000
    if (spin.mean < expected * 0.72) add({ key: 'spin-low', level: 'watch', title: `${name}: low spin`, detail: `${fmt(spin.mean, 0)} rpm is well under the ~${expected} rpm rule of thumb. Expect more roll-out and less stopping power on firm greens.`, articleId: 'spin-loft' })
    if (spin.mean > expected * 1.35) add({ key: 'spin-high', level: 'watch', title: `${name}: high spin`, detail: `${fmt(spin.mean, 0)} rpm is well above the ~${expected} rpm rule of thumb, which balloons the ball and costs distance into the wind. A steep attack with an open face adds spin loft.`, articleId: 'spin-loft' })
  }

  const descent = summary.descent
  if (descent && (kind === 'iron' || kind === 'hybrid') && descent.mean < 40) add({ key: 'descent', level: 'watch', title: `${name}: flat landing angle`, detail: `Estimated landing angle is ${fmt(descent.mean, 0)}°. Approach shots land softest above about 45°; below 40° they release a long way on firm greens.`, articleId: 'spin-loft' })

  const f2p = summary.faceToPath
  if (f2p && f2p.n >= MIN_SHOTS) {
    if (Math.abs(f2p.mean) > 4) {
      const fade = f2p.mean > 0
      add({ key: 'f2p', level: 'focus', title: `${name}: ${fade ? 'fade/slice' : 'draw/hook'} pattern`, detail: `Face to path averages ${signed(f2p.mean)}° (${fade ? 'face open to path' : 'face closed to path'}). Under 2° gives a playable shape; above 4° the curve grows fast.${summary.path ? ` Path averages ${signed(summary.path.mean)}° (${summary.path.mean >= 0 ? 'in to out' : 'out to in'}).` : ''}`, drill: fade ? 'Strengthen the lead-hand grip until you can see two or three knuckles, and feel the lead forearm rotate through impact.' : 'Weaken the grip a touch and hold the face square longer through impact, feeling the chest keep turning.', articleId: 'ball-flight-laws' })
    }
    if (f2p.sd > 3.5) add({ key: 'f2p-sd', level: 'watch', title: `${name}: face control varies`, detail: `Face to path swings by ±${fmt(f2p.sd)}° from shot to shot, so the curve changes direction or size. Consistency here tightens dispersion more than anything else.`, drill: 'Make 20 three-quarter swings at 70% speed, aiming for the same small curve every time before adding speed.', articleId: 'ball-flight-laws' })
  }

  const offline = summary.offline
  const carry = summary.carry
  if (offline && carry && carry.mean > 40) {
    if (offline.sd > carry.mean * 0.08) add({ key: 'dispersion', level: 'focus', title: `${name}: wide dispersion`, detail: `Shots land ±${fmt(offline.sd, 0)} yards offline (one standard deviation), about ${fmt((offline.sd / carry.mean) * 100, 0)}% of carry. Under 5% is a strong player; 8% and up costs fairways and greens.`, articleId: 'dispersion' })
    if (Math.abs(offline.mean) > Math.max(6, carry.mean * 0.05)) add({ key: 'bias', level: 'watch', title: `${name}: misses favour the ${offline.mean > 0 ? 'right' : 'left'}`, detail: `The average shot finishes ${fmt(Math.abs(offline.mean), 0)} yards ${offline.mean > 0 ? 'right' : 'left'} of target (right-handed view). If the shape is repeatable, aim for it rather than fighting it.`, articleId: 'dispersion' })
    if (carry.sd > carry.mean * 0.06) add({ key: 'carry-sd', level: 'watch', title: `${name}: carry distance varies`, detail: `Carry spreads ±${fmt(carry.sd, 0)} yards. Most of that comes from strike quality and speed control.`, drill: 'Hit five balls to one number with the same rhythm, then five at 80% effort, and note both carries.', articleId: 'gapping' })
    else if (offline.sd <= carry.mean * 0.05) add({ key: 'tight', level: 'strength', title: `${name}: tight pattern`, detail: `±${fmt(offline.sd, 0)} yards offline and ±${fmt(carry.sd, 0)} yards of carry. This is a club to trust under pressure.` })
  }

  const impactV = summary.impactV
  if (impactV && impactV.n >= MIN_SHOTS && (kind === 'driver' || kind === 'wood') && impactV.mean < -5) add({ key: 'low-strike', level: 'watch', title: `${name}: strikes low on the face`, detail: `Impact averages ${fmt(Math.abs(impactV.mean), 0)} mm below centre. Low strikes add spin and lose speed; tee it a little higher.`, articleId: 'strike' })
  const impactH = summary.impactH
  if (impactH && impactH.n >= MIN_SHOTS && Math.abs(impactH.mean) > 8) add({ key: 'h-strike', level: 'watch', title: `${name}: strikes off the centre`, detail: `Impact averages ${fmt(Math.abs(impactH.mean), 0)} mm from the centre horizontally. Gear effect from heel and toe strikes curves the ball even with a square face.`, articleId: 'strike' })

  return tips
}

export function gappingTips(summaries: ClubSummary[]): DataTip[] {
  const tips: DataTip[] = []
  const ready = summaries.filter(summary => summary.club && summary.carry && summary.carry.n >= 3 && clubInfo(summary.club)?.kind !== 'putter')
  for (let index = 1; index < ready.length; index++) {
    const longer = ready[index - 1]
    const shorter = ready[index]
    const gap = longer.carry!.mean - shorter.carry!.mean
    const pair = `${clubLabel(longer.club)} → ${clubLabel(shorter.club)}`
    if (gap < 6) tips.push({ id: `gap:${longer.club}:${shorter.club}`, club: shorter.club, level: 'watch', title: `Overlap: ${pair}`, detail: `Only ${fmt(gap, 0)} yards between these carries. One of them may not earn its place in the bag, or a loft change would spread them out.`, articleId: 'gapping' })
    if (gap > 20) tips.push({ id: `gap:${longer.club}:${shorter.club}`, club: shorter.club, level: 'watch', title: `Gap: ${pair}`, detail: `${fmt(gap, 0)} yards between these carries leaves an awkward in-between number. A club or a stock three-quarter swing could fill it.`, articleId: 'gapping' })
  }
  return tips
}

/** When three or more clubs miss to the same side, one bag-wide tip replaces the per-club ones. */
function mergeBias(tips: DataTip[], summaries: ClubSummary[]) {
  const bias = tips.filter(tip => tip.id.endsWith(':bias'))
  if (bias.length < 3) return tips
  const side = (club: string | null) => (summaries.find(summary => summary.club === club)?.offline?.mean ?? 0) > 0 ? 'right' : 'left'
  const right = bias.filter(tip => side(tip.club) === 'right')
  const group = right.length >= 3 ? right : bias.length - right.length >= 3 ? bias.filter(tip => side(tip.club) === 'left') : null
  if (!group) return tips
  const direction = side(group[0].club)
  const names = group.map(tip => clubLabel(tip.club))
  const merged: DataTip = {
    id: `bag:bias-${direction}`,
    club: null,
    level: 'watch',
    title: `Across the bag: misses favour the ${direction}`,
    detail: `${names.join(', ')} all finish ${direction} of target on average (right-handed view). A pattern this consistent usually comes from aim or ball position rather than the swing: check your alignment with a club on the ground, then aim for the shape.`,
    articleId: 'dispersion',
  }
  const dropped = new Set(group.map(tip => tip.id))
  return [...tips.filter(tip => !dropped.has(tip.id)), merged]
}

export function allTips(summaries: ClubSummary[]) {
  const order: Record<TipLevel, number> = { focus: 0, watch: 1, strength: 2 }
  return mergeBias([...summaries.flatMap(clubTips), ...gappingTips(summaries)], summaries).sort((a, b) => order[a.level] - order[b.level])
}
