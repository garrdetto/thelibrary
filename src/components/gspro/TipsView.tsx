import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CircleAlert, Eye, LoaderCircle, Search, Sparkles, ThumbsUp } from 'lucide-react'
import { clubLabel } from '@/lib/gspro/clubs'
import { tipArticles, tipCategories, type TipArticle } from '@/lib/gspro/library'
import { summarizeByClub, type EnrichedShot } from '@/lib/gspro/stats'
import { allTips, MIN_SHOTS, type DataTip } from '@/lib/gspro/tips'
import type { GsproSession } from '@/lib/gspro/types'
import { normalizeClub } from '@/lib/gspro/clubs'
import { gsproApi, type CoachInput, type CoachResult } from './api'
import { ScopePicker } from './ScopePicker'
import { scopeLabel, type Scope } from './GsproApp'

const levels = {
  focus: { label: 'Work on this', icon: CircleAlert },
  watch: { label: 'Keep an eye on', icon: Eye },
  strength: { label: 'Doing well', icon: ThumbsUp },
} as const

const coachMetrics = ['carry', 'total', 'offline', 'ballSpeed', 'clubSpeed', 'smash', 'launch', 'spin', 'spinAxis', 'apex', 'descent', 'attackAngle', 'path', 'face', 'faceToPath', 'dynamicLoft', 'impactH', 'impactV'] as const

function TipCard({ tip, onArticle }: { tip: DataTip; onArticle: (id: string) => void }) {
  const Icon = levels[tip.level].icon
  return <article className={`gs-tip ${tip.level}`}>
    <header><Icon size={16} aria-hidden/><span>{levels[tip.level].label}</span></header>
    <h3>{tip.title}</h3>
    <p>{tip.detail}</p>
    {tip.drill && <p className="gs-drill"><b>Try:</b> {tip.drill}</p>}
    {tip.articleId && <button type="button" className="gs-link" onClick={() => onArticle(tip.articleId!)}>Read the guide</button>}
  </article>
}

function Article({ article, open, onToggle }: { article: TipArticle; open: boolean; onToggle: () => void }) {
  return <article id={`tip-${article.id}`} className={`gs-article ${open ? 'open' : ''}`}>
    <button type="button" className="gs-article-head" aria-expanded={open} onClick={onToggle}>
      <span className="gs-eyebrow">{article.category}</span>
      <h3>{article.title}</h3>
      <p>{article.summary}</p>
    </button>
    {open && <div className="gs-article-body">
      {article.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {article.numbers && <dl className="gs-numbers">{article.numbers.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
      {article.checklist && <ul>{article.checklist.map(item => <li key={item}>{item}</li>)}</ul>}
    </div>}
  </article>
}

export function TipsView({ scope, sessions, shots, error, onScope }: { scope: Scope; sessions: GsproSession[]; shots: EnrichedShot[] | null; error: string | null; onScope: (scope: Scope) => void }) {
  const summaries = useMemo(() => shots ? summarizeByClub(shots) : [], [shots])
  const [lofts, setLofts] = useState<Record<string, number>>({})
  useEffect(() => {
    gsproApi.bag().then(result => setLofts(Object.fromEntries(result.bag.map(club => [normalizeClub(club.name), club.loft]).filter((entry): entry is [string, number] => Boolean(entry[0]))))).catch(() => undefined)
  }, [])
  const tips = useMemo(() => allTips(summaries, lofts), [summaries, lofts])
  const [openArticle, setOpenArticle] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [coach, setCoach] = useState<CoachResult | null>(null)
  const [coaching, setCoaching] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const thin = summaries.filter(summary => summary.shots < MIN_SHOTS)

  const articles = tipArticles.filter(article => (category === 'all' || article.category === category) && (!query.trim() || `${article.title} ${article.summary} ${article.body.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())))

  function showArticle(id: string) {
    setCategory('all')
    setQuery('')
    setOpenArticle(id)
    requestAnimationFrame(() => document.getElementById(`tip-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function askCoach() {
    if (!shots) return
    const handed = shots.filter(shot => shot.handed === 'LH').length > shots.length / 2 ? 'LH' : 'RH'
    const input: CoachInput = {
      scope: scopeLabel(scope, sessions).slice(0, 80),
      handed,
      clubs: summaries.slice(0, 30).map(summary => ({
        club: clubLabel(summary.club).slice(0, 24),
        shots: summary.shots,
        carryEstimated: summary.carryEstimated,
        metrics: Object.fromEntries(coachMetrics.map(key => {
          const metric = summary[key]
          return [key, metric ? { mean: Math.round(metric.mean * 100) / 100, sd: Math.round(metric.sd * 100) / 100 } : null]
        })),
      })),
    }
    setCoaching(true)
    setCoachError(null)
    try { setCoach(await gsproApi.coach(input)) }
    catch (failure) { setCoachError(failure instanceof Error ? failure.message : 'The coach is unavailable right now.') }
    finally { setCoaching(false) }
  }

  return <div className="gs-stack">
    <div className="gs-toolbar"><ScopePicker scope={scope} sessions={sessions} onScope={onScope}/></div>
    {error && <p className="gs-notice" role="alert">{error}</p>}

    <section className="gs-panel">
      <header className="gs-panel-head">
        <div><h2>Tips from your numbers</h2><p>Each club needs {MIN_SHOTS} counted shots before it gets tips.{thin.length ? ` Not enough yet: ${thin.map(summary => clubLabel(summary.club)).join(', ')}.` : ''}</p></div>
        <button type="button" className="gs-button" disabled={coaching || !summaries.length} onClick={askCoach}>
          {coaching ? <LoaderCircle size={15} className="spin" aria-hidden/> : <Sparkles size={15} aria-hidden/>}Ask the AI coach
        </button>
      </header>
      {!shots && !error && <p className="gs-muted" role="status"><LoaderCircle size={16} className="spin" aria-hidden/> Loading shots…</p>}
      {coachError && <p className="gs-notice" role="alert">{coachError}</p>}
      {coach && <div className="gs-coach" aria-live="polite">
        <p className="gs-eyebrow"><Sparkles size={13} aria-hidden/> AI coach · {scopeLabel(scope, sessions)}</p>
        <h3>{coach.headline}</h3>
        <ol>{coach.tips.map((tip, index) => <li key={index}><b>{tip.title}.</b> {tip.detail}{tip.drill ? <span className="gs-drill"> Try: {tip.drill}</span> : null}</li>)}</ol>
      </div>}
      {shots && !tips.length && <p className="gs-muted">{summaries.length ? 'No tips yet: hit a few more shots with each club.' : 'No shots in this selection yet.'}</p>}
      {tips.length > 0 && <div className="gs-tip-grid">{tips.map(tip => <TipCard key={tip.id} tip={tip} onArticle={showArticle}/>)}</div>}
    </section>

    <section className="gs-panel">
      <header className="gs-panel-head"><div><h2><BookOpen size={18} aria-hidden/> Tip hub</h2><p>Short guides to reading the numbers and practising with them.</p></div></header>
      <div className="gs-toolbar">
        <div className="gs-segments" role="group" aria-label="Category">
          {['all', ...tipCategories].map(item => <button key={item} type="button" aria-pressed={category === item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item === 'all' ? 'All' : item}</button>)}
        </div>
        <label className="gs-search"><Search size={14} aria-hidden/><span className="sr-only">Search guides</span><input type="search" placeholder="Search guides" value={query} onChange={event => setQuery(event.target.value)}/></label>
      </div>
      <div className="gs-articles">
        {articles.map(article => <Article key={article.id} article={article} open={openArticle === article.id} onToggle={() => setOpenArticle(current => current === article.id ? null : article.id)}/>)}
        {!articles.length && <p className="gs-muted">No guides match that search.</p>}
      </div>
    </section>
  </div>
}
