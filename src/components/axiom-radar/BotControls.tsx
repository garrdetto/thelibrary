import { useEffect, useState, type ReactNode } from 'react'
import { CirclePause, CirclePlay, LoaderCircle, RotateCcw, XCircle } from 'lucide-react'
import type { BotCommand, BotReport } from '@/lib/axiom-bot'
import { relativeSeconds } from './format'
import type { useBot } from './useBot'
import { useRadarAccess } from './access'

const confirmWindowMs = 4_000

export type BotFeed = ReturnType<typeof useBot>

export const dollars = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const signedDollars = (value: number) => `${value >= 0 ? '+' : '-'}${dollars(Math.abs(value))}`
export const signedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
export const toneOf = (value: number) => value > 0 ? 'up' : value < 0 ? 'down' : ''

export function solAmount(value: number) {
  const size = Math.abs(value)
  const places = size >= 100 ? 2 : size >= 1 ? 3 : 4
  return `${value.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places })} SOL`
}

const smallSol = (value: number) => `${Number(value.toFixed(6))} SOL`

/** SOL first with dollars in brackets. A report from a bot that still keeps dollars has no SOL figure and shows dollars alone. */
export const money = (sol: number | undefined, usd: number) => sol === undefined ? dollars(usd) : `${solAmount(sol)} (${dollars(usd)})`
export const signedMoney = (sol: number | undefined, usd: number) => `${(sol ?? usd) >= 0 ? '+' : '-'}${money(sol === undefined ? undefined : Math.abs(sol), Math.abs(usd))}`
export const headline = (sol: number | undefined, usd: number) => sol === undefined ? dollars(usd) : solAmount(sol)
export const signedHeadline = (sol: number | undefined, usd: number) => sol === undefined ? signedDollars(usd) : `${sol >= 0 ? '+' : '-'}${solAmount(Math.abs(sol))}`
export const bracket = (sol: number | undefined, usd: number) => sol === undefined ? '' : `(${dollars(usd)}) · `

/** One line on the SOL price and what a trade pays the network right now. */
export function feeLine(report: BotReport) {
  if (!report.fees) return ''
  const price = report.solUsd ? `SOL is ${dollars(report.solUsd)}. ` : ''
  return `${price}Network fee now ${smallSol(report.fees.totalSol)} a trade (${report.fees.source}: priority ${smallSol(report.fees.prioritySol)}, bribe ${smallSol(report.fees.bribeSol)}).`
}

/** What the bot is doing right now, for the status chip beside its name. */
export function botStatus(bot: BotFeed, now: number): { tone: string; label: string } {
  const view = bot.view
  const report = view?.report ?? null
  if (!view || !report) return { tone: '', label: 'Not started' }
  if (!view.online) return { tone: 'down', label: `Not running, last seen ${view.reportedAt ? relativeSeconds(view.reportedAt + (bot.receivedAt - view.now), now) : 'never'}` }
  if (report.status === 'running') return { tone: 'up', label: 'Buying' }
  if (report.status === 'paused') return { tone: 'warn', label: 'Paused' }
  return { tone: 'warn', label: `Not buying: ${report.note ?? 'waiting'}` }
}

function ConfirmButton({ label, confirmLabel, icon, busy, disabled, onConfirm }: { label: string; confirmLabel: string; icon: ReactNode; busy: boolean; disabled: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), confirmWindowMs)
    return () => clearTimeout(timer)
  }, [armed])
  return <button type="button" className={`secondary-button ${armed ? 'radar-bot-armed' : ''}`} disabled={disabled || busy} onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>
    {busy ? <LoaderCircle size={13} className="spin"/> : icon}{armed ? confirmLabel : label}
  </button>
}

/** The bot's terminal actions as buttons: pause or resume buying, close every position, reset the account. */
export function BotControls({ bot }: { bot: BotFeed }) {
  const { view, refresh, saveSettings, sendCommand } = bot
  const { canEdit } = useRadarAccess()
  const [busy, setBusy] = useState<'' | 'pause' | keyof BotCommand>('')
  const [notice, setNotice] = useState('')
  if (!view) return null
  if (!canEdit) return <p className="radar-note" role="note">Only the administrator can pause, close or reset the bot.</p>
  const online = view.online
  const buying = view.settings.values['bot.enabled'] !== false

  const act = async (kind: 'pause' | keyof BotCommand, action: () => Promise<unknown>, done: string) => {
    setBusy(kind)
    setNotice('')
    try {
      await action()
      setNotice(done)
      void refresh()
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'That did not go through. Try again.')
    } finally {
      setBusy('')
    }
  }

  return <div className="radar-bot-controls">
    <button type="button" className="secondary-button" disabled={busy !== ''} onClick={() => void act('pause', () => saveSettings({ 'bot.enabled': !buying }), buying ? 'Buying is paused. Open positions are still managed.' : 'Buying is back on.')}>
      {busy === 'pause' ? <LoaderCircle size={13} className="spin"/> : buying ? <CirclePause size={13}/> : <CirclePlay size={13}/>}{buying ? 'Pause buying' : 'Resume buying'}
    </button>
    <ConfirmButton label="Close all positions" confirmLabel="Click again to close all" icon={<XCircle size={13}/>} busy={busy === 'flatten'} disabled={busy !== '' || !view.report?.positions.length} onConfirm={() => void act('flatten', () => sendCommand('flatten'), online ? 'Sent. The bot sells everything on its next pull.' : 'Saved. The bot is not running, so nothing was sold.')}/>
    <ConfirmButton label="Reset account" confirmLabel="Click again to wipe every trade" icon={<RotateCcw size={13}/>} busy={busy === 'reset'} disabled={busy !== ''} onConfirm={() => void act('reset', () => sendCommand('reset'), online ? 'Sent. The account starts again on the bot\'s next pull.' : 'Saved. The bot is not running, so start it within 10 minutes for the reset to apply.')}/>
    <p role="status" className="radar-muted">{notice}</p>
  </div>
}
