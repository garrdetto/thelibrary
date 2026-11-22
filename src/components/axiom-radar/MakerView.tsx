import { Gem, SlidersHorizontal, TrendingUp } from 'lucide-react'
import type { RadarPayload, RadarToken } from '@/lib/axiom-radar-types'
import { LearnedCoin, chanceLabel } from './LearnedCoin'
import { ClimbersSection } from './ClimbersSection'

export type MakerSort = 'match' | 'climber' | 'rules' | 'wallets' | 'explode' | 'double' | 'newest' | 'viewers'

type MakerFilter = { key: string; label: string; detail: string; test: (token: RadarToken) => boolean }

const sorts: Array<{ id: MakerSort; label: string; value: (token: RadarToken, matched: number) => number }> = [
  { id: 'match', label: 'Match to past winners', value: token => token.maker?.chance ?? -1 },
  { id: 'climber', label: 'Looks like a steady climber', value: token => (token.maker?.climberLike ?? 0) * 1_000 + (token.maker?.climb?.minutes ?? 0) },
  { id: 'rules', label: 'Research traits matched', value: (_token, matched) => matched },
  { id: 'wallets', label: 'Winner wallets in', value: token => token.maker?.winnerWallets ?? 0 },
  { id: 'explode', label: 'Chance to explode', value: token => token.explode?.chance ?? -1 },
  { id: 'double', label: 'Chance to double', value: token => token.outlook?.runnerChance ?? -1 },
  { id: 'newest', label: 'Newest first', value: token => -token.ageMinutes },
  { id: 'viewers', label: 'Most viewers', value: token => token.viewers ?? -1 },
]

const percent = (value: number) => `${Math.round(value * 100)}%`

function researchFilters(payload: RadarPayload): MakerFilter[] {
  const rules = payload.winners?.rules ?? []
  return [
    ...rules.map(rule => ({ key: rule.key, label: rule.label, detail: `${percent(rule.winnerRate)} of coins like this became positive winners, vs ${percent(rule.otherRate)} otherwise`, test: (token: RadarToken) => token.maker?.passes.includes(rule.key) ?? false })),
    { key: 'climbing', label: 'Climbing steadily for 30+ minutes', detail: 'Still making highs, rising in most 5-minute steps, never more than 40% off its high on the way up', test: token => Boolean(token.maker?.climb?.rising && (token.maker.climb.minutes ?? 0) >= 30 && token.maker.climb.upShare >= 0.55) },
    { key: 'climber-like', label: 'Volume, liquidity and holders like past steady climbers', detail: (payload.winners?.climbers?.length ?? 0) > 0 ? `At least half what the ${payload.winners?.climbers?.length} saved steady climber${payload.winners?.climbers?.length === 1 ? '' : 's'} had 30 minutes into their climb` : 'No steady climber saved yet, so this uses $5K 5-minute volume and $30K liquidity', test: token => (token.maker?.climberLike ?? 0) >= 0.83 },
    { key: 'winner-wallets', label: 'Wallets from past winners are in', detail: 'At least one top holder also held a Watch List coin', test: token => (token.maker?.winnerWallets ?? 0) > 0 },
    { key: 'explosion-wallets', label: 'Wallets from past explosions are in', detail: 'At least one top holder was in a coin before it exploded', test: token => (token.explode?.earlyWallets ?? 0) > 0 },
    { key: 'jumping', label: 'Jumping right now', detail: 'Viewers or buys are spiking, from the Could explode study', test: token => token.explode !== null && token.explode !== undefined },
    { key: 'likely-double', label: 'Likely to double', detail: 'Crash-timing study gives it a 50%+ chance to at least double', test: token => (token.outlook?.runnerChance ?? 0) >= 0.5 },
    { key: 'early-phase', label: 'Still early in its run', detail: 'Less than half way to when similar coins usually crashed', test: token => token.outlook?.phase === 'early' },
    { key: 'young', label: 'Under 30 minutes old', detail: 'Winners were usually found within minutes of launch', test: token => token.ageMinutes <= 30 },
    { key: 'small', label: 'Market cap under $40K', detail: 'The range the biggest jumps started from', test: token => token.marketCap !== null && token.marketCap < 40_000 },
    { key: 'clean', label: 'No negative characteristics', detail: 'No crash, no warnings, and no failed holder checks such as bundlers, snipers, insiders or concentrated wallets', test: token => token.alerts.length === 0 && !token.advice?.crashed && !token.holderRisk?.blocked && !token.quality.checks.some(check => check.status === 'fail') },
  ]
}

type MakerViewProps = { payload: RadarPayload; tokens: RadarToken[]; onOpen: (mint: string) => void; filters: string[] | null; onFilters: (next: string[] | null) => void; sort: MakerSort; onSort: (next: MakerSort) => void }

export function MakerView({ payload, tokens, onOpen, filters, onFilters, sort, onSort }: MakerViewProps) {
  const summary = payload.winners
  if (!summary) return <p className="radar-empty-line">The winners study has not reported yet. It starts a minute or two after the tracker on your PC restarts with this update.</p>
  const available = researchFilters(payload)
  const selected = filters ?? available.map(filter => filter.key)
  const active = available.filter(filter => selected.includes(filter.key))
  const sorter = sorts.find(item => item.id === sort) ?? sorts[0]
  const ranked = tokens
    .map(token => ({ token, matched: active.filter(filter => filter.test(token)).length }))
    .sort((first, second) => sorter.value(second.token, second.matched) - sorter.value(first.token, first.matched) || (second.token.maker?.chance ?? 0) - (first.token.maker?.chance ?? 0))
  const full = active.length ? ranked.filter(entry => entry.matched === active.length) : ranked
  const closest = active.length ? ranked.filter(entry => entry.matched < active.length && entry.matched > 0).sort((first, second) => second.matched - first.matched).slice(0, 12) : []
  const shown = full.slice(0, 30)
  const toggle = (key: string) => onFilters(selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key])
  const card = ({ token, matched }: { token: RadarToken; matched: number }) => <LearnedCoin key={token.mint} token={token} headline={active.length ? `${matched}/${active.length}` : chanceLabel(token.maker?.chance)} headlineLabel={active.length ? 'filters matched' : 'match to past winners'} reasons={token.maker?.reasons ?? []} onOpen={onOpen}>
    {token.maker?.climb && token.maker.climb.minutes >= 15 && <p className="radar-learn-fact tabular"><TrendingUp size={12} aria-hidden="true"/> {token.maker.climb.rising ? 'Climbing' : 'Climbed'} {token.maker.climb.minutes} min, {token.maker.climb.gain.toFixed(1)}x, up in {Math.round(token.maker.climb.upShare * 100)}% of 5-min steps{(token.maker.climberWallets ?? 0) > 0 ? ` · ${token.maker.climberWallets} climber wallet${token.maker.climberWallets === 1 ? '' : 's'} bought` : ''}</p>}
    <p className="radar-learn-fact tabular">{chanceLabel(token.maker?.chance)} match to past winners{(token.maker?.winnerWallets ?? 0) > 0 ? ` · ${token.maker?.winnerWallets} winner wallet${token.maker?.winnerWallets === 1 ? '' : 's'} in` : ''}{token.explode ? ` · ${chanceLabel(token.explode.chance)} to explode` : ''}</p>
  </LearnedCoin>

  return <div className="radar-learn">
    <div className="radar-section-head"><h2 id="radar-maker-title"><Gem size={16} aria-hidden="true"/> Millionaire Maker <span className="tabular">{shown.length || closest.length}</span></h2>
      <p>My recommended coins: current coins that match what the research found in the biggest coins and in the saved steady climbers (coins that rose for an hour or more with real volume and liquidity to $200K or more). Every research filter starts on. Switch filters off to loosen the match. Filters only change what is shown here: the research keeps running on every coin regardless. A match is a pattern, not a guarantee, and most matches still fail.</p></div>

    <section className="radar-card radar-maker-filters" aria-labelledby="radar-maker-filters-title">
      <div className="panel-heading">
        <h2 id="radar-maker-filters-title"><SlidersHorizontal size={15} aria-hidden="true"/> Research filters</h2>
        <span className="panel-caption">{active.length === available.length ? 'ALL ON' : active.length ? `${active.length} OF ${available.length} ON` : 'ALL OFF'}</span>
      </div>
      <ul className="radar-maker-filter-list">{available.map(filter => {
        const on = selected.includes(filter.key)
        const count = tokens.filter(filter.test).length
        return <li key={filter.key}>
          <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => toggle(filter.key)}>
            <span className="radar-maker-check" aria-hidden="true">{on ? '✓' : ''}</span>
            <span className="radar-maker-filter-text"><strong>{filter.label}</strong><small>{filter.detail}</small></span>
            <span className="radar-maker-count tabular" title="Current coins that match">{count}</span>
          </button>
        </li>
      })}</ul>
      <div className="radar-maker-bar">
        <label className="radar-maker-sort"><span>Sort by</span>
          <select value={sort} onChange={event => onSort(event.target.value as MakerSort)}>{sorts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <div className="radar-maker-actions">
          {active.length < available.length && <button type="button" className="secondary-button" onClick={() => onFilters(null)}>Turn all on</button>}
          {active.length > 0 && <button type="button" className="secondary-button" onClick={() => onFilters([])}>Turn all off</button>}
        </div>
      </div>
    </section>

    {shown.length > 0 && <section aria-label="Recommended coins">
      <div className="radar-section-head"><h2>{active.length ? `Matches all ${active.length} filters` : 'All current coins'} <span className="tabular">{shown.length}</span></h2></div>
      <div className="radar-pick-grid">{shown.map(card)}</div>
    </section>}
    {closest.length > 0 && <section aria-label="Closest matches">
      <div className="radar-section-head"><h2>{shown.length ? 'Next closest' : 'Recommended: closest matches'} <span className="tabular">{closest.length}</span></h2><p>{shown.length ? 'Coins that match most, but not all, of the filters you have on.' : 'No current coin matches every filter that is on, so these are the coins that match the most of them.'}</p></div>
      <div className="radar-pick-grid">{closest.map(card)}</div>
    </section>}
    <ClimbersSection climbers={summary.climbers ?? []}/>
    {shown.length === 0 && closest.length === 0 && <div className="radar-empty"><Gem size={34} strokeWidth={1}/><h3>No current coin matches any filter that is on.</h3><p>Leave this open: coins appear the moment they match.</p></div>}
    <p className="radar-note">{summary.ready ? summary.flaggedHitRate !== null && summary.winnerRate !== null ? `In its own test on coins it had not seen, coins it rated a likely match became positive winners ${Math.round(summary.flaggedHitRate * 100)}% of the time, against ${Math.round(summary.winnerRate * 100)}% for all coins.` : 'Still measuring how often its matches are right.' : 'Needs more finished coins before it can score matches.'}</p>
  </div>
}
