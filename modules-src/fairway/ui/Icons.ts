/** Inline SVG icons for the HUD: club heads by type (wood, hybrid, iron, wedge, putter), shot-type trajectories and lie swatches. Pure markup with currentColor strokes so they follow the theme. */
import type { ClubId, LieKind, ShotKind } from '../tuning'

const svg = (body: string, size = 28, view = '0 0 32 32') => `<svg viewBox="${view}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`

export function clubIcon(club: ClubId, size = 28): string {
  const shaft = '<line x1="23" y1="3" x2="15.5" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="23" y1="3" x2="21.4" y2="7" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" opacity=".75"/>'
  switch (club) {
    case 'driver':
    case 'wood3':
      return svg(`${shaft}<path d="M15.5 20.5c-4.2-.8-9.3.6-10.4 3.6-.9 2.6 1.7 4.6 6.4 4.4 4.4-.2 6.9-2.3 6.2-5.2-.3-1.3-1.1-2.3-2.2-2.8z" fill="url(#fw-wood)" stroke="currentColor" stroke-width="1"/><path d="M7.4 26.2c2.5.7 6 .4 8.4-.9" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".9"/><defs><linearGradient id="fw-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6470"/><stop offset="1" stop-color="#1b2027"/></linearGradient></defs>`, size)
    case 'hybrid5':
      return svg(`${shaft}<path d="M15.6 20.6c-3.4-.4-7.6.9-8.4 3.4-.6 2 1.4 3.6 5.1 3.4 3.6-.2 5.6-1.9 5-4.2-.2-1.2-.8-2.1-1.7-2.6z" fill="#3a434e" stroke="currentColor" stroke-width="1"/><path d="M9 25.6c2 .5 4.6.3 6.4-.6" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width=".8"/>`, size)
    case 'putter':
      return svg(`<line x1="20" y1="3" x2="17" y2="22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="20" y1="3" x2="19.4" y2="7" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" opacity=".75"/><rect x="6" y="22" width="17" height="5.5" rx="1.6" fill="#9aa0a8" stroke="currentColor" stroke-width="1"/><line x1="14.5" y1="22.6" x2="14.5" y2="27" stroke="#fff" stroke-opacity=".7" stroke-width=".9"/>`, size)
    case 'pitching':
    case 'sand':
      return svg(`${shaft}<path d="M16 20.4 7.2 22.6c-1.6.4-2.2 2.2-1.2 3.4l1.4 1.6c.6.7 1.5 1 2.4.8l7.4-1.8z" fill="#d7dbe0" stroke="currentColor" stroke-width="1"/><path d="M8 24.2l7.4-1.8M8.6 25.6l7-1.7" stroke="#6b737d" stroke-width=".6"/>`, size)
    default:
      return svg(`${shaft}<path d="M16 20.4 7.4 22.3c-1.5.3-2.1 2-1.2 3.1l1 1.2c.6.7 1.5 1 2.4.8l7.5-1.7z" fill="#d7dbe0" stroke="currentColor" stroke-width="1"/><path d="M8.2 24.1l7.2-1.6" stroke="#6b737d" stroke-width=".6"/>`, size)
  }
}

export function shotIcon(kind: ShotKind, size = 30): string {
  const ground = '<line x1="2" y1="25" x2="30" y2="25" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/>'
  const ball = (x: number) => `<circle cx="${x}" cy="23.4" r="1.8" fill="#fff" stroke="currentColor" stroke-width=".6"/>`
  switch (kind) {
    case 'full':
      return svg(`${ground}<path d="M4 24C9 4 21 2 28 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>${ball(4)}`, size)
    case 'chip':
      return svg(`${ground}<path d="M4 24C7 17 10 17 13 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.6"/><path d="M13 24.4H27" stroke="currentColor" stroke-width="1.6"/><path d="M25 22.4l2.6 2-2.6 2" fill="none" stroke="currentColor" stroke-width="1.4"/>${ball(4)}`, size)
    case 'flop':
      return svg(`${ground}<path d="M5 24C7 1 17 1 20 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.6"/><path d="M20 24.4h3" stroke="currentColor" stroke-width="1.6"/>${ball(5)}`, size)
    case 'spinner':
      return svg(`${ground}<path d="M4 24C8 13 15 12 20 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.6"/><path d="M20 21.5h-5.5" stroke="currentColor" stroke-width="1.5"/><path d="M16.4 19.6l-2.4 1.9 2.4 1.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M22.5 16.5a3.6 3.6 0 1 1-1.2-2.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M21.6 12.4l-.2 1.9 1.8.3" fill="none" stroke="currentColor" stroke-width="1.1"/>${ball(4)}`, size)
  }
}

const LIE_COLORS: Readonly<Record<LieKind, readonly [string, string]>> = {
  tee: ['#68b84f', '#4c8f39'],
  fairway: ['#6ab851', '#5da845'],
  rough: ['#3f7a33', '#2f5f28'],
  green: ['#80d264', '#73c757'],
  bunker: ['#e8dab0', '#d2c18e'],
  path: ['#c4beb0', '#a39d8e'],
}

export function lieSwatch(lie: LieKind, size = 18): string {
  const [light, dark] = LIE_COLORS[lie]
  const blades =
    lie === 'rough'
      ? '<path d="M4 15l1.5-7M8 15l.5-9M12 15l-1-8M15 15l1-6" stroke="#9ed27a" stroke-width="1.1" stroke-linecap="round"/>'
      : lie === 'bunker'
        ? '<circle cx="6" cy="9" r=".8" fill="#b9a774"/><circle cx="11" cy="12" r=".7" fill="#b9a774"/><circle cx="13" cy="6" r=".6" fill="#b9a774"/>'
        : `<path d="M0 6h18M0 12h18" stroke="${dark}" stroke-width="3"/>`
  return svg(`<rect x="0" y="0" width="18" height="18" rx="4.5" fill="${light}"/>${blades}<rect x=".5" y=".5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-opacity=".35"/>`, size, '0 0 18 18')
}
