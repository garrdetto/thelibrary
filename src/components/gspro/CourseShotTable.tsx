import { Fragment, useMemo, useState } from 'react'
import { Play } from 'lucide-react'
import { clubLabel, clubOrder } from '@/lib/gspro/clubs'
import { surfaceName, type ShotAnalysis } from '@/lib/gspro/course'
import { loadSort, saveSort, sortRows, type SortState } from '@/lib/gspro/sorting'
import { fmt } from '@/lib/gspro/stats'
import type { EnrichedShot } from '@/lib/gspro/stats'
import { useReplay } from './ReplayContext'
import { SortBar, SortHeader } from './SortBar'

const courseKeys = {
  order: { label: 'Order played', value: (item: ShotAnalysis) => item.shot.hole * 100 + item.shot.holeShot, first: 'asc' },
  club: { label: 'Club', value: (item: ShotAnalysis) => clubOrder(item.club), first: 'asc' },
  before: { label: 'Distance to pin', value: (item: ShotAnalysis) => item.before, first: 'desc' },
  carry: { label: 'Carry', value: (item: ShotAnalysis) => item.shot.putt ? null : item.carry, first: 'desc' },
  total: { label: 'Total', value: (item: ShotAnalysis) => item.shot.total, first: 'desc' },
  offline: { label: 'Offline (either side)', value: (item: ShotAnalysis) => item.shot.putt ? null : Math.abs(item.offline), first: 'desc' },
  after: { label: 'Finish from pin', value: (item: ShotAnalysis) => item.after, first: 'asc' },
  ballSpeed: { label: 'Ball speed', value: (item: ShotAnalysis) => item.shot.ball.speed, first: 'desc' },
  launch: { label: 'Launch', value: (item: ShotAnalysis) => item.shot.putt ? null : item.shot.ball.launch, first: 'desc' },
  apex: { label: 'Apex', value: (item: ShotAnalysis) => item.shot.putt ? null : item.apex, first: 'desc' },
} as const

type CourseKey = keyof typeof courseKeys
const keys = Object.keys(courseKeys) as CourseKey[]
const defaultSort: SortState<CourseKey> = { key: 'order', direction: 'asc', byClub: false, club: 'all' }

function distance(yards: number | null, putt: boolean) {
  if (yards === null) return '—'
  return putt || yards < 10 ? `${fmt(yards * 3, 0)} ft` : `${fmt(yards, 0)} yd`
}

export function CourseShotTable({ shots, toReplay }: { shots: ShotAnalysis[]; toReplay: (item: ShotAnalysis) => EnrichedShot }) {
  const [sort, setSortState] = useState<SortState<CourseKey>>(() => typeof window === 'undefined' ? defaultSort : loadSort('course', keys, defaultSort))
  const openReplay = useReplay()
  const sorted = useMemo(() => {
    const filtered = sort.club === 'all' ? shots : shots.filter(item => (item.club ?? '') === sort.club)
    return sortRows(filtered, courseKeys[sort.key].value, sort.direction, sort.byClub && sort.key !== 'club' ? item => item.club : undefined)
  }, [shots, sort])
  const replayList = useMemo(() => sorted.map(toReplay), [sorted, toReplay])
  const grouped = sort.byClub && sort.key !== 'club'
  const counts = useMemo(() => {
    const map = new Map<string | null, number>()
    for (const item of sorted) map.set(item.club, (map.get(item.club) ?? 0) + 1)
    return map
  }, [sorted])

  function setSort(next: SortState<CourseKey>) {
    setSortState(next)
    saveSort('course', next)
  }

  const header = (key: CourseKey, label: string) => <SortHeader sortKey={key} state={sort} onChange={setSort} first={courseKeys[key].first}>{label}</SortHeader>
  return <>
    <SortBar keys={courseKeys} state={sort} onChange={setSort} clubs={shots.map(item => item.club)} count={sorted.length}/>
    <div className="gs-table-wrap" tabIndex={0} aria-label="Course shots">
      <table className="gs-table">
        <thead><tr>
          <th scope="col"><span className="sr-only">Replay</span></th>{header('order', 'Hole')}{header('club', 'Club')}<th scope="col">From</th>{header('before', 'To pin')}{header('carry', 'Carry')}{header('total', 'Total')}
          {header('offline', 'Offline')}{header('ballSpeed', 'Ball')}{header('launch', 'Launch')}{header('apex', 'Apex')}<th scope="col">Finish</th>{header('after', 'From pin')}
        </tr></thead>
        <tbody>
          {sorted.map((item, index) => {
            const startsGroup = grouped && (index === 0 || sorted[index - 1].club !== item.club)
            const { shot } = item
            return <Fragment key={shot.id}>
              {startsGroup && <tr className="gs-group-row"><th colSpan={13} scope="rowgroup">{shot.putt && item.club === 'PT' ? 'Putter' : clubLabel(item.club)} <span>{counts.get(item.club)} shot{counts.get(item.club) === 1 ? '' : 's'}</span></th></tr>}
              <tr className="gs-row" onClick={event => { if (!(event.target as HTMLElement).closest('button')) openReplay(replayList, index) }}>
                <td><button type="button" className="gs-play" aria-label={`Replay hole ${shot.hole + 1}, shot ${shot.holeShot}`} onClick={() => openReplay(replayList, index)}><Play size={13} aria-hidden/></button></td>
                <td>{shot.hole + 1}<small>·{shot.holeShot}</small></td>
                <td>{shot.putt ? 'Putt' : clubLabel(item.club)}</td>
                <td>{surfaceName(shot.startSurface)}</td>
                <td>{distance(item.before, shot.putt)}</td>
                <td>{shot.putt ? '—' : fmt(item.carry, 0)}</td>
                <td>{shot.putt ? distance(shot.total, true) : fmt(shot.total, 0)}</td>
                <td>{shot.putt ? '—' : `${fmt(Math.abs(item.offline), 0)}${item.offline >= 0 ? 'R' : 'L'}`}</td>
                <td>{fmt(shot.ball.speed)}</td>
                <td>{shot.putt ? '—' : fmt(shot.ball.launch)}</td>
                <td>{shot.putt ? '—' : `${fmt(item.apex, 0)} ft`}</td>
                <td>{shot.final ? 'Holed' : surfaceName(shot.endSurface)}</td>
                <td>{shot.final ? '—' : distance(item.after, shot.endSurface === 5)}</td>
              </tr>
            </Fragment>
          })}
        </tbody>
      </table>
    </div>
  </>
}
