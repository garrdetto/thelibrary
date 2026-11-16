# Sun Vault

An original Egyptian-temple video reel module for the library, played on play credits only. It teaches weighted probability and expected value: the paytable explains the long-run return, and the developer panel simulates up to a million spins.

## Layout

- `engine/` is pure TypeScript and never touches the DOM. `SlotEngine.spin(bet, force?)` returns a complete `SpinResult`; the visuals only replay it.
- `render/` is the WebGPU layer: a procedural atlas, WGSL shaders, the GPU renderer, reel physics and the scene that builds each frame.
- `play/director.ts` sequences a result into animation, sound and banners.
- `ui/` is the React and Tailwind HUD.

## Features

- 5×3 reels, 25 fixed lines, Pyramid Wild on reels 2–4, Temple Scatter on 1, 3 and 5.
- Sun Coins carry cash or MINI, MINOR or MAJOR. A Sphinx collector on reel 5 gathers every coin on screen and can expand to 2×2 (×2) or 3×3 (×3) first.
- 6 free spins from three scatters. Collectors also land on reels 3–4, and each collect grows the Sphinx Zone (1×1 → 2×2 → 3×3). A collector inside the zone expands to at least the zone's size.
- Vault Respins: six or more coins lock and award 3 respins. Each new coin or collector resets to 3, and new collectors gather the locked coins. All 15 filled pays the GRAND (2,000× bet).
- Jackpot Pick: about 1 in 600 paid spins opens a 3×3 board. The first jackpot revealed three times is won. The engine fixes the reveal order in advance, so the result doesn't depend on which tiles are clicked.
- Reel 5 runs a 2.5 s anticipation spin when reels 1–4 show two scatters or five coins.

## Tuning

Change the numbers in `engine/paytable.ts`, then check the return:

```
node scripts/sunvault-tests.mjs
```

The last test simulates 400,000 rounds and expects a return between 90% and 100%. The developer panel (bug icon, or `?debug=1`) can force every feature, toggle each shader effect, fire the particle effects and run longer simulations. `window.__sunvault` exposes the scene, engine and renderer for browser tests.
