import { GraduationCap } from 'lucide-react'
import type { BotLearning, BotLesson, BotMistakes } from '@/lib/axiom-bot'

function percent(value: number | null): string {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function LessonRow({ lesson }: { lesson: BotLesson }) {
  const tone = lesson.avgPct > 0 ? 'up' : lesson.avgPct < 0 ? 'down' : ''
  return <li>
    <span>{lesson.feature}{lesson.timing && <span className="radar-bot-tag">timing</span>}</span>
    <span>Coins {lesson.band}</span>
    <strong className={`tabular radar-delta ${tone}`}>{percent(lesson.avgPct)}</strong>
    <span className="tabular radar-muted">{lesson.winPct}% won · {lesson.seen} seen</span>
  </li>
}

/** The bot's look back at its own buys: which mistakes keep losing (and now block buys) and the latest reviews. */
function BotMistakesCard({ mistakes }: { mistakes: BotMistakes }) {
  return <>
    <h4>Bad buys it learned from</h4>
    {!mistakes.enabled && <p className="radar-muted">Learning from bad buys is off: trades are still reviewed but nothing is skipped.</p>}
    {mistakes.lessons.length === 0
      ? <p className="radar-muted">No trades reviewed yet. A mistake blocks buys once {mistakes.minTrades} trades have shown it and most of them lost.</p>
      : <ul className="radar-bot-lessons">{mistakes.lessons.map(lesson => <li key={lesson.tag}>
          <span>{lesson.active ? <span className="radar-bot-tag warn">skipping</span> : <span className="radar-bot-tag">watching</span>}</span>
          <span>{lesson.label}</span>
          <strong className={`tabular radar-delta ${lesson.avgPct > 0 ? 'up' : lesson.avgPct < 0 ? 'down' : ''}`}>{percent(lesson.avgPct)}</strong>
          <span className="tabular radar-muted">{lesson.losses} of {lesson.trades} lost</span>
        </li>)}</ul>}
    {mistakes.recent.length > 0 && <><h4>Latest trades looked back on</h4><ul className="radar-bot-reviews">{mistakes.recent.slice(0, 5).map(review => <li key={`${review.mint}-${review.closedAt}`}>{review.text}</li>)}</ul></>}
  </>
}

/** What the bot's notebook has learned: how many coins it has followed, how they did, and the bands that pay or lose. */
export function BotLearningCard({ learning }: { learning: BotLearning | null }) {
  if (!learning) return <p className="radar-note radar-bot-learning-note">The bot reports what it has learned once it is running this version.</p>
  if (!learning.enabled) return <p className="radar-note radar-bot-learning-note">Learning is off. The bot buys on the score and the picky level alone.</p>
  const good = learning.lessons.filter(lesson => lesson.avgPct > 0)
  const bad = learning.lessons.filter(lesson => lesson.avgPct <= 0)
  return <div className="radar-bot-learning" aria-live="polite">
    <h3><GraduationCap size={14} aria-hidden="true"/> What the bot has learned</h3>
    <dl className="radar-bot-learning-stats">
      <div><dt>Coins followed to the end</dt><dd className="tabular">{learning.watched.toLocaleString()}</dd></div>
      <div><dt>Being followed now</dt><dd className="tabular">{learning.following}</dd></div>
      <div><dt>Own trades studied</dt><dd className="tabular">{learning.trades}</dd></div>
      <div><dt>Average after costs</dt><dd className="tabular">{percent(learning.avgPct)}</dd></div>
      <div><dt>Buy level now</dt><dd className="tabular">{learning.buyLevel}{learning.adjust !== 0 && <small> ({learning.adjust > 0 ? '+' : ''}{learning.adjust} from recent trades)</small>}</dd></div>
    </dl>
    {learning.recentWinPct !== null && <p className="radar-note">Won {learning.recentWinPct}% of the last {learning.recentTrades} trades. {learning.adjust > 0 ? 'The buy level is raised until that improves.' : learning.adjust < 0 ? 'Winning often, so the buy level is a little lower.' : 'The buy level is unchanged.'}</p>}
    {learning.lessons.length === 0
      ? <p className="radar-muted">Still collecting. A pattern counts once {learning.minSeen} coins have shown it; with the Radar running that takes about an hour.</p>
      : <>
        {bad.length > 0 && <><h4>Skipped or waited out</h4><ul className="radar-bot-lessons">{bad.map(lesson => <LessonRow key={`${lesson.feature}-${lesson.band}`} lesson={lesson}/>)}</ul></>}
        {good.length > 0 && <><h4>Paid best</h4><ul className="radar-bot-lessons">{good.map(lesson => <LessonRow key={`${lesson.feature}-${lesson.band}`} lesson={lesson}/>)}</ul></>}
      </>}
    {learning.mistakes && <BotMistakesCard mistakes={learning.mistakes}/>}
  </div>
}
