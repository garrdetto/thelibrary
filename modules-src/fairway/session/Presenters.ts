/** Turns match and shot state into display models: scorecard rows, HUD values and record-book text. Pure formatting, no DOM. */
import type { ModuleConfig } from '../config'
import { clubById, type ClubId, type LieKind, type ShotKind } from '../tuning'
import { clubReachTable } from '../systems/ClubAdvice'
import { currentCourseHole, currentWind, parThrough, placements, scoreLabel, strokesThisHole, totalStrokes, type MatchState, type PlayerState } from '../systems/Match'
import type { FairwayBoard, FairwayRecordRow } from '../systems/Records'
import type { BoardCopy, ScorecardModel } from '../ui/Screens'
import type { HudModel } from '../ui/HudView'
import { horizontalDistance, type Vec3 } from '../systems/Vector'

export function metresAndYards(config: ModuleConfig, metres: number): string {
  const copy = config.presenters
  return copy.distance(metres.toFixed(metres < copy.decimalsBelow ? 1 : 0), (metres / config.metresPerYard).toFixed(metres < copy.decimalsBelow ? 1 : 0))
}

function relative(total: number, par: number): string {
  const diff = total - par
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
}

function holesPlayed(player: PlayerState): number {
  return player.strokes.filter((value) => value !== null).length
}

/** Holes this player has finished: every hole before the current one, plus the current one once holed or picked up. */
function holesCompleted(state: MatchState, player: PlayerState): number {
  if (state.finished) return holesPlayed(player)
  return state.holeIndex + (player.holed || player.pickedUp ? 1 : 0)
}

export interface ShotPlanView {
  /** Selected shot type, or null on a putt. */
  shot: ShotKind | null
  power: number
  /** Perfect-strike carry (full shots) or roll-out distance (putts and short game), when known. */
  distance: number | null
  /** Launch spin of the perfect strike, when known. */
  spinRpm: number | null
  /** True while the local player is aiming and may change the setup. */
  editable: boolean
}

export function hudModel(config: ModuleConfig, state: MatchState, player: PlayerState, ball: Vec3, club: ClubId | null, lie: LieKind, spin: number, cameraYaw: number, plan: ShotPlanView | null): HudModel {
  const holeIndex = currentCourseHole(state)
  const hole = config.holes[holeIndex]
  const wind = currentWind(state)
  const pin: Vec3 = [hole.pin[0], ball[1], hole.pin[1]]
  const played = holesCompleted(state, player)
  const total = player.strokes.slice(0, played).reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const spinIndex = spin > 0 ? 2 : spin < 0 ? 0 : 1
  const pinMode = state.mode === 'pin'
  const copy = config.hud
  const spec = club ? clubById(club) : null
  const reach = club ? clubReachTable().find((entry) => entry.club === club) : undefined
  const putting = lie === 'green' || club === 'putter'
  return {
    holeNumber: String(hole.number),
    holeName: hole.name,
    par: String(hole.par),
    stroke: pinMode ? '1' : String(strokesThisHole(player, state.holeIndex) + 1),
    total: pinMode ? '—' : played ? `${total} (${relative(total, parThrough(state, played))})` : '0',
    holeLength: copy.holeLength(hole.yards, Math.round(hole.yards * config.metresPerYard)),
    windSpeed: config.presenters.wind(wind.speed.toFixed(1)),
    windAngle: cameraYaw - wind.yaw,
    windStrength: wind.speed / Math.max(1e-6, config.wind.speedRange[1]),
    club,
    clubName: spec ? spec.name : '—',
    clubDetail: spec ? (spec.putter ? copy.putterDetail : copy.clubDetail(spec.loftDegrees, reach ? Math.round(reach.carry) : null)) : '',
    lie,
    lieLabel: copy.lieLabels[lie],
    toPin: metresAndYards(config, horizontalDistance(ball, pin)),
    spin,
    spinLabel: `${copy.spinLabels[spinIndex]}${spin !== 0 ? ` ${Math.round(Math.abs(spin) * 100)}%` : ''}`,
    spinDetail: plan?.spinRpm ? copy.spinRpm(Math.round(plan.spinRpm / 50) * 50) : '',
    shotKind: plan?.shot ?? null,
    shotHint: plan?.shot ? copy.shotHints[plan.shot] : '',
    power: plan ? plan.power : null,
    powerLabel: plan ? `${Math.round(plan.power * 100)}%` : '—',
    distanceLabel: plan && plan.distance !== null ? copy.planDistance(metresAndYards(config, plan.distance), plan.shot !== 'full') : '',
    editable: !!plan?.editable,
    putting,
  }
}

export function scorecardModel(config: ModuleConfig, state: MatchState, finished: boolean): ScorecardModel {
  const copy = config.presenters
  const holes = state.holes.map((index) => config.holes[index])
  if (state.mode === 'pin') {
    const player = state.players[0]
    const results = player?.pinDistances ?? []
    const valid = results.filter((value): value is number => value !== null)
    const best = valid.length ? Math.min(...valid) : null
    return {
      eyebrow: config.hud.modeNames.pin,
      title: finished ? copy.pinFinishedTitle : copy.scorecardTitle,
      summary: best === null ? copy.pinNoResult : copy.pinBest(metresAndYards(config, best)),
      headers: [copy.holeColumn, copy.parColumn, copy.resultColumn],
      rows: holes.map((hole, index) => {
        const value = results[index]
        const played = player?.strokes[index] !== null
        return [{ text: `${hole.number} · ${hole.name}` }, { text: String(hole.par) }, { text: !played ? '–' : value === null ? copy.penaltyResult : value === 0 ? config.scoreNames.ace : metresAndYards(config, value), tone: value === 0 ? 'under' : undefined }]
      }),
      continueLabel: finished ? null : copy.nextHole,
    }
  }
  const standings = placements(state)
  const leader = standings[0]
  const summary = finished
    ? state.mode === 'online' && leader
      ? copy.onlineWinner(standings.filter((row) => row.place === 1).map((row) => row.name).join(' & '), leader.total)
      : copy.soloFinished(totalStrokes(state.players[0]), relative(totalStrokes(state.players[0]), parThrough(state, state.holes.length)))
    : copy.throughHoles(state.players.reduce((most, player) => Math.max(most, holesPlayed(player)), 0), state.holes.length)
  const parRow = [{ text: copy.parColumn }, ...holes.map((hole) => ({ text: String(hole.par) })), { text: String(parThrough(state, holes.length)) }]
  const playerRows = state.players.map((player) => [
    { text: player.name },
    ...holes.map((hole, index) => {
      const strokes = player.strokes[index]
      if (strokes === null) return { text: '–' }
      return { text: String(strokes), tone: strokes < hole.par ? ('under' as const) : strokes > hole.par ? ('over' as const) : undefined }
    }),
    { text: String(totalStrokes(player)) },
  ])
  return {
    eyebrow: config.hud.modeNames[state.mode],
    title: finished ? copy.finalTitle : copy.scorecardTitle,
    summary,
    headers: [copy.holeColumn, ...holes.map((hole) => String(hole.number)), copy.totalColumn],
    rows: [parRow, ...playerRows],
    continueLabel: finished || state.mode === 'online' ? null : copy.nextHole,
  }
}

export function holeOutMessage(config: ModuleConfig, strokes: number, par: number): string {
  return config.presenters.holedOut(scoreLabel(strokes, par), strokes)
}

export function boardCopy(config: ModuleConfig): BoardCopy {
  const copy = config.presenters
  const ordinal = (place: number) => `${place}${copy.ordinals[Math.min(place, copy.ordinals.length) - 1] ?? 'th'}`
  const format = (board: FairwayBoard, value: number) => (board === 'round' ? copy.strokes(value) : board === 'pin' ? metresAndYards(config, value / 100) : ordinal(value))
  return {
    empty: copy.boardEmpty,
    loading: copy.boardLoading,
    failed: copy.boardFailed,
    columns: copy.boardColumns,
    format(board: FairwayBoard, row: FairwayRecordRow) {
      const hole = typeof row.detail?.holeName === 'string' ? ` · ${row.detail.holeName}` : ''
      return `${format(board, row.value)}${board === 'pin' ? hole : ''}`
    },
    personalBest: (board, value) => copy.personalBest(format(board, value)),
  }
}
