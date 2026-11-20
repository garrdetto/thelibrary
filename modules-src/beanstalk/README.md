# Beanstalk Bounty

An original fairy-tale reel module for the library, played on play credits only. It teaches how chance compounds: a single sprout can climb a reel and branch across the screen, and the paytable and developer panel show how those branching odds set the long-run return.

## Layout

- `engine/` is pure TypeScript and never touches the DOM. `BeanstalkEngine.spin(bet, force?)` returns a complete `SpinResult`; the page only replays it, and the Worker runs the same code for signed-in members.
- `render/` is Canvas 2D: procedural symbol art (`art.ts`) and the stage (`stage.ts`).
- `ui/` is the React and Tailwind HUD.

## Features

- 5 reels × 4 rows, 1,024 ways. A symbol pays on three or more adjacent reels from the left; each matching symbol on a reel adds a way.
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
