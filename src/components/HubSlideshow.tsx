import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, Trophy } from 'lucide-react'
import { isModuleAvailable, learningModules } from '@/lib/modules'
import type { ModuleId } from '@/lib/modules'
import type { ScoredModuleId } from '@/lib/module-scores'
import { formatScore, isScoredModule, scoreBoardParent, scoredModules } from '@/lib/module-scores'

type PopularBoard = { module: string; plays: number; records: { username: string; value: number }[] }

type Slide = { id: ModuleId; board: ScoredModuleId; title: string; subject: string; image: string; accent: string; records: PopularBoard['records']; metric: string; plays: number }

const rotateMs = 6000

export function HubSlideshow({ onLaunch, fallbackId }: { onLaunch: (id: ModuleId) => void; fallbackId: ModuleId }) {
  const [boards, setBoards] = useState<PopularBoard[] | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/module-scores?popular', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() as Promise<{ popular: PopularBoard[] }> : Promise.reject(new Error('failed')))
      .then(data => { if (active) setBoards(data.popular) })
      .catch(() => { if (active) setBoards([]) })
    return () => { active = false }
  }, [])

  const seen = new Set<string>()
  const slides: Slide[] = (boards ?? []).flatMap(board => {
    if (!isScoredModule(board.module)) return []
    const boardId = board.module
    const item = learningModules.find(entry => entry.id === scoreBoardParent(boardId))
    if (!item || !isModuleAvailable(item.id) || !board.records.length || seen.has(item.id)) return []
    seen.add(item.id)
    return [{ id: item.id, board: boardId, title: item.title, subject: item.subject, image: item.image, accent: item.accent, records: board.records, metric: scoredModules[boardId].title, plays: board.plays }]
  })
  const fallback = learningModules.find(entry => entry.id === fallbackId) ?? learningModules[0]
  const count = slides.length
  const current = count ? slides[index % count] : null

  const step = useCallback((delta: number) => setIndex(value => count ? (value + delta + count) % count : 0), [count])

  useEffect(() => {
    if (paused || count < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => step(1), rotateMs)
    return () => window.clearInterval(timer)
  }, [paused, count, step])

  if (!current) {
    return <button type="button" className="hub-hero-art" onClick={() => onLaunch(fallback.id)} aria-label={`Launch ${fallback.title}`}>
      <img src={fallback.image} alt=""/>
      <span className="hub-badge"><Trophy size={12}/> FEATURED MODULE</span>
      <span className="hub-hero-caption"><strong>{fallback.title}</strong><small>{fallback.subject}</small></span>
    </button>
  }

  return <div className="hub-slideshow" style={{ '--module-accent': current.accent } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Popular modules and top scores" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <div className="hub-slide" key={current.id} aria-live={paused ? 'polite' : 'off'}>
      <img src={current.image} alt=""/>
      <span className="hub-badge"><Trophy size={12}/> POPULAR · TOP SCORES</span>
      <div className="hub-slide-panel">
        <small>{current.subject} · {current.plays.toLocaleString()} results saved</small>
        <strong>{current.title}</strong>
        <ol aria-label={`${current.title} ${current.metric}`}>
          {current.records.map((record, place) => <li key={`${record.username}-${place}`}><span>{place + 1}</span><em>{record.username}</em><b>{formatScore(current.board, record.value)}</b></li>)}
        </ol>
        <button type="button" className="hub-slide-play" onClick={() => onLaunch(current.id)}>Play {current.title} <ArrowRight size={14}/></button>
      </div>
    </div>
    {count > 1 && <div className="hub-slide-controls">
      <button type="button" onClick={() => step(-1)} aria-label="Previous slide"><ChevronLeft size={16}/></button>
      <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}>{paused ? <Play size={14}/> : <Pause size={14}/>}</button>
      <button type="button" onClick={() => step(1)} aria-label="Next slide"><ChevronRight size={16}/></button>
      <span className="hub-slide-dots">{slides.map((slide, position) => <button type="button" key={slide.id} className={position === index % count ? 'is-active' : ''} onClick={() => setIndex(position)} aria-label={`Show ${slide.title}`}/>)}</span>
    </div>}
  </div>
}
