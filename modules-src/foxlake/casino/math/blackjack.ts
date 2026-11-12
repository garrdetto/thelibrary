/**
 * Blackjack as a pure state machine (the server keeps the state between
 * actions, so the hole card and the shoe never reach the browser).
 * House rules: six decks reshuffled when a quarter remains, dealer stands on
 * soft 17, blackjack pays 3:2, double on any first two cards (also after a
 * split), one split of any pair, split aces get one card each, no surrender,
 * no insurance.
 */
import { pick, type Rng } from './rng'

export type Card = string

export interface Hand {
  cards: Card[]
  bet: number
  done: boolean
  doubled: boolean
  /** Split aces take one card and stand. */
  splitAces: boolean
}

export type Phase = 'player' | 'settled'

export interface Table {
  shoe: Card[]
  dealer: Card[]
  hands: Hand[]
  active: number
  phase: Phase
  /** Credits returned to the player when settled (stakes plus winnings); 0 while playing. */
  payout: number
  results: ('win' | 'lose' | 'push' | 'blackjack')[]
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = ['S', 'H', 'D', 'C']
export const DECKS = 6

export function newShoe(rng: Rng): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < DECKS; d++) for (const s of SUITS) for (const r of RANKS) shoe.push(r + s)
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1)
    const t = shoe[i]
    shoe[i] = shoe[j]
    shoe[j] = t
  }
  return shoe
}

export function rankOf(card: Card): string {
  return card.slice(0, -1)
}

/** Best total and whether an ace still counts 11. */
export function total(cards: readonly Card[]): { value: number; soft: boolean } {
  let value = 0
  let aces = 0
  for (const c of cards) {
    const r = rankOf(c)
    if (r === 'A') {
      aces++
      value += 11
    } else value += r === 'J' || r === 'Q' || r === 'K' ? 10 : Number(r)
  }
  while (value > 21 && aces > 0) {
    value -= 10
    aces--
  }
  return { value, soft: aces > 0 }
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && total(cards).value === 21
}

function draw(t: Table, rng: Rng): Card {
  if (t.shoe.length < (DECKS * 52) / 4) t.shoe = newShoe(rng)
  return t.shoe.pop()!
}

/** Deals a new round for `bet` from an existing shoe (or a fresh one). */
export function deal(bet: number, rng: Rng, shoe: Card[] | null): Table {
  const t: Table = { shoe: shoe && shoe.length ? shoe : newShoe(rng), dealer: [], hands: [{ cards: [], bet, done: false, doubled: false, splitAces: false }], active: 0, phase: 'player', payout: 0, results: [] }
  t.hands[0].cards.push(draw(t, rng))
  t.dealer.push(draw(t, rng))
  t.hands[0].cards.push(draw(t, rng))
  t.dealer.push(draw(t, rng))
  if (isBlackjack(t.hands[0].cards) || isBlackjack(t.dealer)) settle(t, rng)
  return t
}

export type Action = 'hit' | 'stand' | 'double' | 'split'

/** What the active hand may do now. */
export function allowed(t: Table): Action[] {
  if (t.phase !== 'player') return []
  const h = t.hands[t.active]
  if (h.done) return []
  const out: Action[] = ['hit', 'stand']
  if (h.cards.length === 2) out.push('double')
  if (h.cards.length === 2 && t.hands.length === 1 && value10(h.cards[0]) === value10(h.cards[1])) out.push('split')
  return out
}

function value10(card: Card): string {
  const r = rankOf(card)
  return r === 'J' || r === 'Q' || r === 'K' ? '10' : r
}

/** Applies an action. Returns the extra stake it needs from the player (a double or a split), or null if not allowed. */
export function act(t: Table, action: Action, rng: Rng): number | null {
  if (!allowed(t).includes(action)) return null
  const h = t.hands[t.active]
  let stake = 0
  if (action === 'hit') {
    h.cards.push(draw(t, rng))
    if (total(h.cards).value >= 21) h.done = true
  } else if (action === 'stand') h.done = true
  else if (action === 'double') {
    stake = h.bet
    h.bet *= 2
    h.doubled = true
    h.cards.push(draw(t, rng))
    h.done = true
  } else {
    stake = h.bet
    const aces = rankOf(h.cards[0]) === 'A'
    const second: Hand = { cards: [h.cards.pop()!], bet: h.bet, done: false, doubled: false, splitAces: aces }
    h.splitAces = aces
    h.cards.push(draw(t, rng))
    second.cards.push(draw(t, rng))
    t.hands.push(second)
    if (aces) {
      h.done = true
      second.done = true
    }
  }
  advance(t, rng)
  return stake
}

function advance(t: Table, rng: Rng): void {
  while (t.active < t.hands.length && t.hands[t.active].done) t.active++
  if (t.active >= t.hands.length) settle(t, rng)
}

function settle(t: Table, rng: Rng): void {
  t.phase = 'settled'
  t.active = Math.min(t.active, t.hands.length - 1)
  const anyLive = t.hands.some((h) => total(h.cards).value <= 21)
  const dealerBj = isBlackjack(t.dealer)
  const playerBj = t.hands.length === 1 && isBlackjack(t.hands[0].cards)
  if (anyLive && !dealerBj && !playerBj) {
    for (;;) {
      const d = total(t.dealer)
      if (d.value >= 17) break
      t.dealer.push(draw(t, rng))
    }
  }
  const dv = total(t.dealer).value
  t.payout = 0
  t.results = t.hands.map((h) => {
    const pv = total(h.cards).value
    if (playerBj && !dealerBj) {
      t.payout += h.bet * 2.5
      return 'blackjack'
    }
    if (dealerBj) {
      if (playerBj) {
        t.payout += h.bet
        return 'push'
      }
      return 'lose'
    }
    if (pv > 21) return 'lose'
    if (dv > 21 || pv > dv) {
      t.payout += h.bet * 2
      return 'win'
    }
    if (pv === dv) {
      t.payout += h.bet
      return 'push'
    }
    return 'lose'
  })
}

/** The table as the player may see it: the dealer's hole card hidden while the hand is live, no shoe. */
export function publicView(t: Table) {
  return {
    dealer: t.phase === 'player' ? [t.dealer[0], '??'] : t.dealer,
    dealerTotal: t.phase === 'player' ? total([t.dealer[0]]).value : total(t.dealer).value,
    hands: t.hands.map((h) => ({ cards: h.cards, bet: h.bet, total: total(h.cards).value, done: h.done, doubled: h.doubled })),
    active: t.active,
    phase: t.phase,
    allowed: allowed(t),
    payout: t.payout,
    results: t.results,
    shoeLeft: t.shoe.length,
  }
}

export type BlackjackView = ReturnType<typeof publicView>
