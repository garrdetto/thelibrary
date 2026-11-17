import type { BotEvent } from '../../lib/solana-bot-client'

const typeLabels: Record<BotEvent['event_type'], string> = {
  detection: 'Detected',
  quote: 'Quote',
  simulation: 'Simulated',
  broadcast: 'Sent',
  trade: 'Trade',
  error: 'Error',
  status: 'Status',
  info: 'Info',
}

function shorten(value: string, keep = 4) {
  return value.length > keep * 2 + 3 ? `${value.slice(0, keep)}…${value.slice(-keep)}` : value
}

function timeOf(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour12: false })
}

export function AxiomBotFeed({ events, onClear }: { events: BotEvent[]; onClear: () => void }) {
  return <section className="adm-card axb-feed" aria-labelledby="axb-feed-title">
    <div className="adm-card-head">
      <h3 id="axb-feed-title">Trade &amp; event feed</h3>
      <button type="button" className="adm-btn adm-btn-ghost" onClick={onClear} disabled={events.length === 0}>Clear</button>
    </div>
    {events.length === 0
      ? <p className="adm-empty">No events yet. Start the bot to see detected coins, quotes, simulations and trades here as they happen.</p>
      : <ol className="axb-events" aria-live="polite" aria-relevant="additions">
        {events.map((event, index) => <li key={`${event.timestamp}-${index}`} className={`axb-event axb-level-${event.level}`}>
          <time dateTime={event.timestamp}>{timeOf(event.timestamp)}</time>
          <span className={`axb-type axb-type-${event.event_type}`}>{typeLabels[event.event_type]}</span>
          <span className="axb-message">
            {event.message}
            {event.mint && <> <span className="adm-muted">· coin</span> <a href={`https://solscan.io/token/${encodeURIComponent(event.mint)}`} target="_blank" rel="noopener noreferrer" title={event.mint}>{shorten(event.mint)}</a></>}
            {event.signature && <> <span className="adm-muted">· tx</span> <a href={`https://solscan.io/tx/${encodeURIComponent(event.signature)}`} target="_blank" rel="noopener noreferrer" title={event.signature}>{shorten(event.signature, 6)}</a></>}
          </span>
          <span className="axb-latency">{event.latency_ms === null ? '' : `${Math.round(event.latency_ms)} ms`}</span>
        </li>)}
      </ol>}
  </section>
}

export { shorten }
