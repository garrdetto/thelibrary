import { ExternalLink } from 'lucide-react'
import type { RadarPayload } from '@/lib/axiom-radar-types'
import { relativeSeconds, shortAddress, solscanAccountUrl } from './format'

export function WalletsView({ payload, now, onOpen }: { payload: RadarPayload; now: number; onOpen: (mint: string) => void }) {
  const tracked = new Set(payload.tokens.map(token => token.mint))
  const holders = payload.wallets.filter(wallet => wallet.source === 'holder')
  const buyers = payload.wallets.filter(wallet => wallet.source === 'early-buyer')
  const minimum = payload.settings.wallets.minRunnerHits
  return <div className="radar-wallets">
    <section className="radar-card">
      <div className="panel-heading"><h2>Smart holders</h2><span className="panel-caption">{holders.length} WALLETS</span></div>
      <p className="radar-note">Wallets found among the top holders of at least {minimum} good coins. A coin counts as good once it passes $500K market cap, climbs 2.5x after being tracked, or wins a paper trade. Coins these wallets hold show a 🐋 on the radar.</p>
      {holders.length === 0 ? <p className="radar-muted">No wallet qualifies yet. The list fills in as tracked coins prove themselves; it usually takes a few hours of running.</p>
        : <ul className="radar-wallet-list">{holders.map(wallet => <li key={wallet.wallet}>
          <div className="radar-wallet-head">
            <a href={solscanAccountUrl(wallet.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(wallet.wallet)}<ExternalLink size={11}/></a>
            <strong className="tabular">🐋 {wallet.runnerHits} good coins</strong>
            <small>seen {relativeSeconds(wallet.updatedAt, now)}</small>
          </div>
          <div className="radar-wallet-coins">{wallet.entries.map(entry => tracked.has(entry.mint)
            ? <button key={entry.mint} type="button" className={entry.good ? 'good' : ''} onClick={() => onOpen(entry.mint)}>{entry.symbol}{entry.pct !== null && <small className="tabular">{entry.pct.toFixed(1)}%</small>}</button>
            : <span key={entry.mint} className={entry.good ? 'good' : ''}>{entry.symbol}{entry.pct !== null && <small className="tabular">{entry.pct.toFixed(1)}%</small>}</span>)}</div>
        </li>)}</ul>}
    </section>
    <section className="radar-card">
      <div className="panel-heading"><h2>Early buyers of runners</h2><span className="panel-caption">{payload.walletTracking === 'on' ? `${buyers.length} WALLETS` : 'NEEDS HELIUS KEY'}</span></div>
      {payload.walletTracking === 'no-key'
        ? <p className="radar-muted">Add a free Helius API key to the tracker's .env file (HELIUS_API_KEY) to also track wallets that bought runners early and see their new buys as they happen.</p>
        : buyers.length === 0 ? <p className="radar-muted">No early buyers recorded yet. They are added when a tracked coin becomes a runner.</p>
        : <ul className="radar-wallet-list">{buyers.map(wallet => <li key={wallet.wallet}>
          <div className="radar-wallet-head">
            <a href={solscanAccountUrl(wallet.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(wallet.wallet)}<ExternalLink size={11}/></a>
            <strong className="tabular">🐋 early in {wallet.runnerHits} runners</strong>
            <small>updated {relativeSeconds(wallet.updatedAt, now)}</small>
          </div>
          <div className="radar-wallet-coins">{wallet.entries.map(entry => <span key={entry.mint}>{entry.symbol}<small>{relativeSeconds(entry.timestamp, now)}</small></span>)}</div>
        </li>)}</ul>}
    </section>
  </div>
}
