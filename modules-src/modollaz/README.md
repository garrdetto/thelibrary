# Mo' Dollaz

An original cash-and-bling slot: five reels, three rows, 20 lines, bets of $0.25 to $5 on play credits. Built phone first: portrait, a side control rail in short landscape, and desktop, with mobile full screen inside the site.

## Layout

- `engine/game.ts`: `DollazGame`, the cents wrapper around the shared casino maths (`modules-src/foxlake/casino/math/machines.ts`, family `dollaz`, id `mo-dollaz`). The same maths runs the Mo' Dollaz cabinet in the Fox Lake casino.
- `engine/simulate.ts`: return and feature rates.
- `render/art.ts`: procedural symbol art (money bag, cash bills, coins, gold-bar wild, vault scatter, supercar, ring, watch, champagne, shades, royals).
- `render/stage.ts`: the Canvas 2D reels and the 5×5 Cash Collect board.
- `ui/`: the React + Tailwind HUD (`App.tsx`, `Bars.tsx`, `PickBoard.tsx`, `Paytable.tsx`).
- `net/api.ts`: `/api/modollaz` (`src/server/routes/modollaz.ts`, `src/server/modollaz.ts`).

## Features

- **Cash Collect.** A money bag on reel 1 with any cash bill on reels 2 to 5 starts it, and any bill may also start it on its own. The bills are paid and copied onto a 5×5 board. The bag is a 2×2 collector zone with 5 spins: coins that land inside it are collected, then it hops to every new bill and grabs it. Five, nine and twelve bills grow it to 3×3 (+3 spins), 4×4 (+2) and 5×5 (+1; no more bills land then).
- **Free games.** Three or more vaults pay and give 8 free games without the royals. Three more add 8, and Cash Collect can start inside them.
- **Jackpot pick.** Any wild may start it: crack 15 safes, and the first jackpot shown three times wins. Jackpots are fixed: Mini 20×, Minor 60×, Maxi 100×, Major 200×, Grand 2,000× the bet.
- **Meters.** Every bill, vault and wild that lands fills its meter (levels 1 to 5). A full meter guarantees its feature.
- **Wins.** Rounds of 15× the bet or more get BIG WIN, 50× or more HUGE WIN (`modules-src/_shared/win-fx.ts`). Cash Collect, free games and jackpots add up in big letters in the middle of the screen.

## Accounts

Signed-in members spin on the shared vault wallet (Sun Vault's balance) with the daily collect and three high-score boards. The server runs every spin; a whole round, features included, resolves in one call. Guests and practice mode run the same engine in the page.

## Tuning

`node scripts/casino-sim.mjs 1000000` reports Mo' Dollaz's return (about 95.5%), base share and feature rates. `scale` in its definition sets the return; the strips, cash weights, collect chances and meter sizes set the shape. Run `node scripts/modollaz-tests.mjs` and `node scripts/foxlake-tests.mjs` after changes.
