import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RadarToken } from '@/lib/axiom-radar-types'

export type ScoreMode = { runner: boolean; dex: boolean }

const storageKey = 'tl-axiom-score-mode'
const defaultMode: ScoreMode = { runner: true, dex: false }

/** The score a coin shows under the chosen systems: either one, or the average of both when both are on. */
export function displayScore(token: RadarToken, mode: ScoreMode) {
  const dex = token.dex?.score ?? null
  if (mode.dex && !mode.runner) return dex ?? 0
  if (mode.dex && mode.runner && dex !== null) return Math.round((token.score + dex) / 2)
  return token.score
}

export function scoreModeLabel(mode: ScoreMode) {
  return mode.runner && mode.dex ? 'Blended score' : mode.dex ? 'DexScreener score' : 'Runner score'
}

function readStoredMode(): ScoreMode {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as Partial<ScoreMode> | null
    if (parsed && typeof parsed.runner === 'boolean' && typeof parsed.dex === 'boolean' && (parsed.runner || parsed.dex)) return { runner: parsed.runner, dex: parsed.dex }
  } catch { }
  return defaultMode
}

type ScoreModeValue = { mode: ScoreMode; toggle: (system: keyof ScoreMode) => void; scoreOf: (token: RadarToken) => number }

const ScoreModeContext = createContext<ScoreModeValue>({ mode: defaultMode, toggle: () => undefined, scoreOf: token => token.score })

export function ScoreModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ScoreMode>(defaultMode)
  useEffect(() => setMode(readStoredMode()), [])
  const toggle = useCallback((system: keyof ScoreMode) => {
    setMode(current => {
      const next = { ...current, [system]: !current[system] }
      if (!next.runner && !next.dex) return current
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { }
      return next
    })
  }, [])
  const value = useMemo<ScoreModeValue>(() => ({ mode, toggle, scoreOf: token => displayScore(token, mode) }), [mode, toggle])
  return <ScoreModeContext.Provider value={value}>{children}</ScoreModeContext.Provider>
}

export function useScoreMode() {
  return useContext(ScoreModeContext)
}

/** Two switches on the Radar's main bar: the runner score (Axiom figures) and the DexScreener score (movement, volume, liquidity). */
export function ScoreModeToggle() {
  const { mode, toggle } = useScoreMode()
  const only = (system: keyof ScoreMode) => mode[system] && !mode[system === 'runner' ? 'dex' : 'runner']
  return <div className="radar-window-picker radar-score-mode" role="group" aria-label="Scoring systems">
    <span>Scoring</span>
    <button type="button" aria-pressed={mode.runner} className={mode.runner ? 'active' : ''} disabled={only('runner')} title={only('runner') ? 'Turn on the DexScreener score before turning this off' : 'Runner score: Axiom viewers, holders and holder percentages'} onClick={() => toggle('runner')}>Runner</button>
    <button type="button" aria-pressed={mode.dex} className={mode.dex ? 'active' : ''} disabled={only('dex')} title={only('dex') ? 'Turn on the runner score before turning this off' : 'DexScreener score: price movement over 5s, 30s, 1m and 5m with liquidity and volume'} onClick={() => toggle('dex')}>DexScreener</button>
  </div>
}
