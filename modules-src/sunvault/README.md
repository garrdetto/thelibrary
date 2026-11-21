# Sun Vault

An original Egyptian-temple video reel module for the library, played on play credits only. It teaches weighted probability and expected value: the paytable explains the long-run return, and the developer panel simulates up to a million spins.

## Layout

- `engine/` is pure TypeScript and never touches the DOM. `SlotEngine.spin(bet, force?)` returns a complete `SpinResult`; the visuals only replay it.
- `render/` is the WebGPU layer: a procedural atlas, WGSL shaders, the GPU renderer, reel physics and the scene that builds each frame.
- `play/director.ts` sequences a result into animation, sound, banners and the shared win effects (`modules-src/_shared/win-fx.ts`).
- `ui/` is the React and Tailwind HUD.

## Bets

`BET_LEVELS_CENTS` runs $0.20, $0.50, $1, $1.50, $2, $2.50, $3, $4 and $5 (default $1, `DEFAULT_BET_CENTS`); the Worker accepts only these. Every level is a whole number of cents per line pay, coin prize and scatter pay (a test checks it), so rounding never moves the return; an odd level such as $0.25 would round $0.125 coins up and add about half a point of return. A free-spins or Vault Respins feature that was opened at an older, larger bet keeps playing at its own stored bet, and the HUD shows that bet (jackpots, paytable, pick board) until it ends.

## Screens

The page runs in the library's play frame and, on phones and touch tablets, in the site's mobile full screen (`initEmbedFull()` from `modules-src/_shared/embed-full.js`; the header's Exit full screen button is `.tl-full-only` with `data-tl-exit-full`). `ui/useViewport.ts` picks one of three layouts, which only rearrange a fixed grid of header, stage and controls so the WebGPU canvas never remounts:

- `wide` (desktop and landscape tablets): one header row, the controls bar below the reels.
- `phone` (narrower than 640 px, or a touch screen in portrait up to 1023 px): title and icons, then four jackpot plaques with short amounts, then the daily collect for members; below the reels the balance, bet and win readouts and one row of Auto, −, a large SPIN, + and Turbo.
- `short` (landscape up to 520 px tall): a slim header (title, jackpots, exit), the reels filling the rest, and a side column with the icons, daily collect, balance, win, bet stepper, SPIN, Auto and Turbo.

Every control is at least 44 px, the page respects safe areas (`viewport-fit=cover`), and banners and the pick board say "Tap" on touch screens. Tapping the reels while a spin plays hurries it like Space. `Scene.resize` sizes the cells from the frame's real extent and slims the pillars, bands and corner ankhs when the stage is under 600 × 480 CSS px, so the grid fills a phone's width or a landscape phone's height. Coins counted out of Vault Respins fly to `meterPoint()`, which follows the Win readout (`scene.meterTarget`), below the reels or to the side column.

## Big wins and centre totals

A round worth 15× the bet or more ends with the shared `createWinFx` celebration: BIG WIN, or HUGE WIN from 50×, in Cinzel letters with coins, gems and sparks, counting up to the amount over the WebGPU coin fountain (tap to skip the count, tap again to close; turbo halves it; Space closes it). Collection features add up in big animated letters in the middle of the screen with `tally()`, over a soft dim of the stage (`.sv-tally-dim`): SPHINX COLLECT adds each coin as it reaches the collector, then the zone multiplier; VAULT WIN adds each coin as it is counted out of the vault (jackpot coins and the GRAND show as its subtitle); a Jackpot Pick counts up its jackpot; free spins end on TEMPLE TOTAL; the daily collect counts up DAILY VAULT. The running temple total rolls in the free-spins chip. Banners are kept for triggers only (free spins, Vault Respins, Jackpot Pick, GRAND, Sphinx Zone, Haywire).

## Features

- 5×3 reels, 25 fixed lines, Pyramid Wild on reels 2–4, Temple Scatter on 1, 3 and 5.
- Sun Coins carry cash or MINI, MINOR or MAJOR. A Sphinx collector on reel 5 gathers every coin on screen and can expand to 2×2 (×2) or 3×3 (×3) first.
- 6 free spins from three scatters. Collectors also land on reels 3–4, and each collect grows the Sphinx Zone (1×1 → 2×2 → 3×3). A collector inside the zone expands to at least the zone's size.
- Vault Respins: six or more coins lock and award 3 respins. Each new coin or collector resets to 3, and new collectors gather the locked coins. All 15 filled pays the GRAND (2,000× bet).
- Haywire: about 1 in 100 paid base spins (`HAYWIRE_ODDS`, never in free spins or respins) the machine goes haywire and one effect, drawn by `HAYWIRE_EFFECTS`, changes the grid before it pays: Wild Surge (3–5 line symbols on reels 2–4 become Pyramid Wilds), Coin Storm (a Sphinx on reel 5 plus cash-only Sun Coins from `HAYWIRE_COIN_PRIZES` until 3–5 coins show, never six, so it never opens Vault Respins) or Double Trouble (the spin's whole win ×2, ×3 or ×5 from `HAYWIRE_MULTIPLIERS`). The result carries `haywire: { kind, cells, multiplier }`, and `Stats.haywires` counts them (older saved states load with 0). During the spin the reels glitch: a shader RGB split, tearing and scanlines (`globals.flags.w`), jittering reel windows, frame shake, a CSS scanline flicker over the stage and a synthesized zap; then a HAYWIRE! banner names the effect and the changed cells glow. With reduced motion only the banner, the highlight and the sound play.
- Jackpot Pick: about 1 in 900 paid spins opens a 3×3 board. The first jackpot revealed three times is won. The engine fixes the reveal order in advance, so the result doesn't depend on which tiles are clicked.
- Reel 5 runs a 2.5 s anticipation spin when reels 1–4 show two scatters or five coins.

## Accounts, daily collect and high scores

Signed in on the library, spins run on the Worker (`/api/sunvault`) against a balance saved in D1, so balances and records can't be forged from the page. Members collect $500 once a day plus $50 for every consecutive day before it (five days in a row makes the next collect $750). When a round ends, the Worker records it on three boards shown under the frame: biggest win, biggest win as a multiple of the bet, and total won. Guests, and members who turn on practice mode in the developer panel, run the same engine in the page with practice credits; forcing works there and nothing is saved or ranked. The administrator can force outcomes on the saved balance, and forced rounds are never ranked.

## Tuning

Change the numbers in `engine/paytable.ts`, then check the return:

```
node scripts/sunvault-tests.mjs
```

The last test simulates 400,000 rounds and expects a return between 90% and 100%. The developer panel (bug icon, or `?debug=1`) can force every feature (Force Haywire included), toggle each shader effect, fire the particle effects and run longer simulations. `window.__sunvault` exposes the scene, engine, renderer and win effects for browser tests.
