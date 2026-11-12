/**
 * How each machine looks: its title, colours and every symbol's art (drawn by
 * `screen/SymbolArt.ts`). Themes, names and symbols are this game's own; the
 * rules they sit on are in `math/machines.ts`.
 */
import type { SymbolStyle } from './screen/SymbolArt'

export interface MachineTheme {
  title: string
  tagline: string
  /** Screen background (top, bottom), reel back (centre, edge), accent, and the title's colour. */
  sky: [string, string]
  reelBack: [string, string]
  accent: string
  titleColor: string
  /** LED colour around the cabinet. */
  led: string
  symbols: Record<string, SymbolStyle>
  /** What the feature trigger is called on screen. */
  orbName?: string
}

const rank = (glyph: string, color: string, light: string): SymbolStyle => ({ glyph, kind: 'rank', color, light })
const RANKS: Record<string, SymbolStyle> = {
  '9': rank('9', '#2f6fd6', '#a9ccff'),
  '10': rank('10', '#2e9b48', '#b6f0a8'),
  J: rank('J', '#7b3fc4', '#e0c2ff'),
  Q: rank('Q', '#e07a1a', '#ffd9a0'),
  K: rank('K', '#c62828', '#ffb3a8'),
  A: rank('A', '#d8a21a', '#fff0a6'),
}
const pic = (glyph: string, color: string, light: string, caption?: string): SymbolStyle => ({ glyph, kind: 'picture', color, light, caption })
const coin = (color = '#d9a21b', light = '#ffe9a0', glyph = '★'): SymbolStyle => ({ glyph, kind: 'coin', color, light })

function link(title: string, tagline: string, sky: [string, string], accent: string, led: string, s: { h1: string; h2: string; h3: string; h4: string; wild: string; scatter: string; orb: string; orbColor: string; orbLight: string; orbName: string }): MachineTheme {
  return {
    title, tagline, sky, reelBack: ['#0d1c34', '#050b16'], accent, titleColor: '#fff3c4', led, orbName: s.orbName,
    symbols: {
      ...RANKS,
      h1: pic(s.h1, '#7a2030', '#ffb0a0'), h2: pic(s.h2, '#1f4f7a', '#a8d8ff'), h3: pic(s.h3, '#2c6b3a', '#b0f0b0'), h4: pic(s.h4, '#5a3a7a', '#e0c0ff'),
      W: { glyph: s.wild, kind: 'wild', color: '#3a1460', light: '#f0d0ff', caption: 'WILD' },
      S: { glyph: s.scatter, kind: 'scatter', color: '#7a4a08', light: '#ffe08a', caption: 'FREE GAMES' },
      O: { ...coin(s.orbColor, s.orbLight, s.orb) },
    },
  }
}

function house(title: string, tagline: string, sky: [string, string], accent: string, led: string, s: { h1: string; h2: string; h3: string; p1: string; p2: string; wild: string; hat: string }): MachineTheme {
  return {
    title, tagline, sky, reelBack: ['#f4ead2', '#c9b48a'], accent, titleColor: '#fff6d8', led, orbName: 'HARD HATS',
    symbols: {
      '10': RANKS['10'], J: RANKS.J, Q: RANKS.Q, K: RANKS.K, A: RANKS.A,
      h1: pic(s.h1, '#8a2a1e', '#ffb59a', 'BRICK'), h2: pic(s.h2, '#7a4a1c', '#f5c890', 'STICK'), h3: pic(s.h3, '#a08018', '#fff0a0', 'STRAW'),
      p1: pic(s.p1, '#4a6a2a', '#d8f0a0'), p2: pic(s.p2, '#2a5a6a', '#a8e8f8'),
      W: { glyph: s.wild, kind: 'wild', color: '#3a3a44', light: '#e8e8f0', caption: 'WILD' },
      H: { glyph: s.hat, kind: 'special', color: '#c88a10', light: '#fff0a0', caption: 'BUILD' },
    },
  }
}

function gold(title: string, tagline: string, sky: [string, string], accent: string, led: string, s: { h1: string; h2: string; h3: string; h4: string; h5: string; wild: string }): MachineTheme {
  return {
    title, tagline, sky, reelBack: ['#2a1608', '#120802'], accent, titleColor: '#ffe9a0', led,
    symbols: {
      ...RANKS,
      h1: pic(s.h1, '#6a3a12', '#ffd090'), h2: pic(s.h2, '#3a4a2a', '#d0e8a0'), h3: pic(s.h3, '#2a3a5a', '#b0d0ff'), h4: pic(s.h4, '#4a4a52', '#e0e0f0'), h5: pic(s.h5, '#7a3a1a', '#ffc8a0'),
      W: { glyph: s.wild, kind: 'wild', color: '#b8500c', light: '#ffe0a0', caption: 'WILD' },
      C: coin('#c88a10', '#fff0a0', '★'),
      G: { glyph: s.h1, kind: 'picture', color: '#b07a08', light: '#fff2b0', caption: 'GOLD' },
    },
  }
}

function collect(title: string, tagline: string, sky: [string, string], accent: string, led: string, s: { h1: string; h2: string; h3: string; h4: string; collector: string }): MachineTheme {
  return {
    title, tagline, sky, reelBack: ['#0e2a24', '#04100c'], accent, titleColor: '#f0fff0', led,
    symbols: {
      '10': RANKS['10'], J: RANKS.J, Q: RANKS.Q, K: RANKS.K, A: RANKS.A,
      h1: pic(s.h1, '#6a2a1a', '#ffc0a0'), h2: pic(s.h2, '#1a4a6a', '#a0d8ff'), h3: pic(s.h3, '#4a5a1a', '#e0f0a0'), h4: pic(s.h4, '#5a2a5a', '#f0c0f0'),
      M: { glyph: s.collector, kind: 'special', color: '#3a2a12', light: '#ffd890', caption: 'COLLECT' },
      B: { glyph: '💎', kind: 'wild', color: '#1a4ab8', light: '#a8c8ff', caption: 'WILD' },
      N: { glyph: '💎', kind: 'special', color: '#1a8a3a', light: '#a8ffb8', caption: 'CASH' },
      P: { glyph: '💎', kind: 'scatter', color: '#b81a7a', light: '#ffb0e0', caption: 'FREE' },
      O: coin('#c88a10', '#fff0a0', '$'),
    },
  }
}

export const THEMES: Record<string, MachineTheme> = {
  'northern-lights-link': link('Northern Lights Link', 'Hold & Spin for the Grand', ['#06223a', '#0a4a3a'], '#5fffd0', '#40e0ff',
    { h1: '🐻‍❄️', h2: '🦉', h3: '🦌', h4: '🦭', wild: '❄️', scatter: '🏔️', orb: '✦', orbColor: '#18a8a0', orbLight: '#b0fff0', orbName: 'AURORA ORBS' }),
  'gold-pan-link': link('Gold Pan Link', 'Hold & Spin for the Grand', ['#3a1a06', '#6a3a0a'], '#ffc040', '#ffb020',
    { h1: '🤠', h2: '🫏', h3: '⛏️', h4: '🪓', wild: '💰', scatter: '🚂', orb: '◆', orbColor: '#c8900a', orbLight: '#fff0a0', orbName: 'GOLD NUGGETS' }),
  'lodge-builders': house('Lodge Builders', 'Build it up, watch it blow!', ['#1a4a2a', '#5a8a3a'], '#ffd860', '#80ff60',
    { h1: '🦫', h2: '🦦', h3: '🐿️', p1: '🪵', p2: '🌲', wild: '🐻', hat: '⛑️' }),
  'hay-day-barns': house('Hay Day Barns', 'Build it up, watch it blow!', ['#6a1a12', '#c86a1a'], '#fff080', '#ff6040',
    { h1: '🐄', h2: '🐐', h3: '🐑', p1: '🚜', p2: '🌽', wild: '🌪️', hat: '🔨' }),
  'moose-gold': gold('Moose Gold', '1,024 ways · collect gold heads', ['#2a0a3a', '#c85a12'], '#ffc040', '#ff9020',
    { h1: '🫎', h2: '🐻', h3: '🦅', h4: '🐺', h5: '🦊', wild: '🌅' }),
  'mustang-gold': gold('Mustang Gold', '1,024 ways · collect gold heads', ['#3a1206', '#d88a2a'], '#ffd060', '#ffb030',
    { h1: '🐎', h2: '🐂', h3: '🦅', h4: '🐍', h5: '🦂', wild: '🌄' }),
  'moose-gold-revolution': gold('Moose Gold Revolution', 'Spin the wheel · 1,024 ways', ['#0a0a3a', '#7a1a6a'], '#ff70d0', '#c040ff',
    { h1: '🫎', h2: '🐻', h3: '🦅', h4: '🐺', h5: '🦊', wild: '🌅' }),
  'mustang-gold-revolution': gold('Mustang Gold Revolution', 'Spin the wheel · 1,024 ways', ['#061a3a', '#1a6a8a'], '#60e0ff', '#2090ff',
    { h1: '🐎', h2: '🐂', h3: '🦅', h4: '🐍', h5: '🦂', wild: '🌄' }),
  'bigfoot-bucks': collect('Bigfoot Bucks', 'Collect · Free Games · Jackpots', ['#0a2a1a', '#2a5a2a'], '#90ff60', '#40ff80',
    { h1: '🏕️', h2: '🛶', h3: '🔦', h4: '🗺️', collector: '👣' }),
  'lake-monster-loot': collect('Lake Monster Loot', 'Collect · Free Games · Jackpots', ['#06223a', '#0a5a6a'], '#60ffe0', '#20d0ff',
    { h1: '⚓', h2: '🎣', h3: '🛥️', h4: '🐟', collector: '🦕' }),
}
