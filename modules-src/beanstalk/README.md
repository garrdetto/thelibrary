# Beanstalk Bounty

An original fairy-tale reel module for the library, played on play credits only. It teaches how chance compounds: a single sprout can climb a reel and branch across the screen, and the paytable and developer panel show how those branching odds set the long-run return.

## Layout

- `engine/` is pure TypeScript and never touches the DOM. `BeanstalkEngine.spin(bet, force?)` returns a complete `SpinResult`; the page only replays it, and the Worker runs the same code for signed-in members.
- `render/` is Canvas 2D: procedural symbol art (`art.ts`) and the stage (`stage.ts`).
- `ui/` is the React and Tailwind HUD.

## Screens

The page fits three shapes, switched in `styles.css` (`narrow`, `short` and `wide` variants plus the `bs-*` grid classes):

- Phone portrait (narrower than 700 px): a slim header (title, rules, developer panel, sound), the reels across the full width with the beanstalks climbing the screen edges behind the board, and a two-row footer (balance, bet, win; auto, spin, turbo). The developer panel opens as a bottom sheet.
- Phone landscape (520 px tall or less): the reels fill the height on the left and every control sits in a right-hand rail, with spin, auto and turbo at the bottom for the thumb.
- Desktop and tablets: header, reels with the beanstalks outside the board, and a one-row footer.

Every button is at least 44 px, nothing relies on hover, and the header, footer, rail and rules dialog keep clear of the safe areas (`viewport-fit=cover`). The page calls `initEmbedFull()` from `../_shared/embed-full.js`, so on phones and tablets the library can stretch its frame over the whole screen; the header then shows an "Exit full screen" button (`tl-full-only`, `data-tl-exit-full`). `render/stage.ts` sizes the board from the canvas: it keeps the side beanstalks outside the board when that costs no more than a tenth of the board's size and otherwise draws them along the screen edges behind it.

## Wins and the Sky Garden total

- Ordinary wins show a plaque on the board whose amount counts up.
- When a round ends (a base spin with no feature, or the last Sky Garden spin) and it paid 15× the bet or more, `createWinFx` from `../_shared/win-fx.ts` plays BIG WIN (15×) or HUGE WIN (50×) over the whole screen with a count-up, coins, leaves and sparks. Turbo shortens it, a tap skips the count and a second tap closes it, Space or Enter closes it from the keyboard.
- The Sky Garden opens a tally titled SKY GARDEN over the reels. Each free spin's win is added as it lands, so the running total counts up in big letters in the middle; while the reels spin the tally fades back so the spin can be watched. The last spin finishes it as SKY GARDEN WON, then the round gets its Big or Huge celebration if it reached one. A Sky Garden resumed after a reload reopens the tally at its total so far. Haywire stays a per-spin banner.

## Features

- 5 reels × 4 rows, 1,024 ways. A symbol pays on three or more adjacent reels from the left; each matching symbol on a reel adds a way.
- Bets are $0.25, $0.50, $1 (the default), $1.50, $2, $2.50, $3, $4 or $5 (`BET_LEVELS_CENTS`; the Worker accepts only these). A way pays `pay × ways × bet / 122`, rounded to the cent and never less than 1 cent, so small bets never show a zero-cent win. A Sky Garden opened at an older, bigger bet still finishes at its own bet.
- Sprout Wild (reels 2–5): carries ×1, ×2 or ×3, and every way through it is multiplied. After the reels stop it climbs 0–3 cells up its reel, turning symbols into Vine Wilds, and each part of the stalk may spread sideways onto the next reel (right more often than left, weaker with every step). Ways made only of wilds pay as the Cloud Giant.
- Cloud Castle (reels 1, 3, 5): three or more pay 2×, 10× or 50× and open the Sky Garden, 5 free spins where every wild that lands or grows stays put to the last spin.
- Haywire: about 1 in 75 paid spins the reels glitch out and one of three things happens: Overgrowth (2–3 extra sprouts whose vines spread much further), Giant Stalk (a ×2 sprout that grows up a whole reel) or Bean Burst (the whole spin ×2, ×3 or ×5).

## Accounts

Signed-in members spin on the same vault balance as Sun Vault (`/api/beanstalk`, D1 `beanstalk_profiles` for the machine state, `sunvault_profiles` for the wallet) and share its daily collect. When a round ends the Worker records it on three boards shown under the frame: biggest win, biggest multiple of the bet and total won. Guests and practice mode run the same engine in the page.

## Tuning

Change the numbers in `engine/paytable.ts`, then check the return:

```
node scripts/beanstalk-tests.mjs
```

The last test simulates 400,000 rounds and expects a return between 90% and 100% (about 97% now). The developer panel (bug icon, or `?debug=1`) forces each feature and runs a 100,000-round simulation.
