import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ModuleScoreboard } from './ModuleScoreboard'
import { isScoredModule, scoreBoardGroups, scoreBoardLabel } from '@/lib/module-scores'
import type { ScoredModuleId } from '@/lib/module-scores'

export function ModuleScoreTabs({ moduleId, username }: { moduleId: string; username: string | null }) {
  const boards = scoreBoardGroups[moduleId] ?? []
  const [selected, setSelected] = useState<ScoredModuleId | undefined>(boards[0])
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => { setSelected(boards[0]) }, [moduleId])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; module?: string } | null
      if ((data?.type === 'tl-score-saved' || data?.type === 'tl-score-board') && data.module && isScoredModule(data.module) && boards.includes(data.module)) setSelected(data.module)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [boards])

  if (!selected) return null

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = boards.indexOf(selected as ScoredModuleId)
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? boards.length - 1 : -2
    if (next === -2) return
    event.preventDefault()
    const target = (next + boards.length) % boards.length
    setSelected(boards[target])
    tabRefs.current[target]?.focus()
  }

  const tabs = <div className="module-scores-tabs" role="tablist" aria-label="Leaderboards" onKeyDown={onKeyDown}>
    {boards.map((board, index) => <button
      key={board}
      ref={element => { tabRefs.current[index] = element }}
      type="button"
      role="tab"
      id={`scores-tab-${board}`}
      aria-selected={board === selected}
      aria-controls={`scores-${board}-title`}
      tabIndex={board === selected ? 0 : -1}
      className={board === selected ? 'is-active' : undefined}
      onClick={() => setSelected(board)}
    >{scoreBoardLabel(board)}</button>)}
  </div>

  return <ModuleScoreboard key={selected} module={selected} username={username} tabs={tabs}/>
}
