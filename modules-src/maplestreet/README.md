# Maple Street (source)

Source for `public/modules/maplestreet.html`, a 3D neighborhood builder: buy a lot, build and furnish a house on a 1 m grid, drive (pickup with trailer, sedan, golf cart, four-wheeler, riding mower), mow striped lawns, haul deliveries and borrow from a bank with a capped loan.

The published page has no build step at runtime. three.js r172 (WebGPU with automatic WebGL2 fallback), Rapier 0.14 (`@dimforge/rapier3d-compat`, `await RAPIER.init()` runs before the loop starts), PeerJS 1.5.4 and colyseus.js 0.15.28 all load from unpkg, through the import map and script tags in `index.html`. The TypeScript in this folder is bundled into the page's inline module script.

## Rebuild

```sh
bun modules-src/maplestreet/build.mjs
# or, without Bun:
pnpm add -D esbuild && node modules-src/maplestreet/build.mjs
```

Edit the TypeScript and `index.html`, not the generated page. This folder is excluded from the site `tsconfig.json`, so its bare imports (`three/webgpu`, Rapier) don't affect the site's type check.

## Connection modes

| Mode | How | Authority |
| --- | --- | --- |
| Solo (Local Offline Simulation) | "Explore solo", `?solo=1` | `src/net/Host.ts` in the page |
| Online room | "Host a room" gives a 6-letter code; others join with it, `?room=CODE` or a chat invite | the host's browser (`PeerTransport`), up to 8 neighbors |
| Same-device tabs | More options → Same-device tabs | the tab holding the Web Lock (`LocalTransport`) |
| Colyseus | More options → server URL, or `?server=wss://…` | `colyseus-server/` (Node) |

Every mode runs the same `shared/RoomLogic.ts`: lot ownership (you can never edit or demolish another player's lot), build validation, money, the $50,000 loan cap with daily interest, mowing pay and delivery checks. If a server, room or PeerJS can't be reached, the module falls back to the offline simulation and shows a notice. Hosted neighborhoods include simulated neighbors (drivers on the ring road, walkers on Main Street) and four furnished starter houses (`shared/Seed.ts`).

Identity is a random per-browser key plus the chosen name, kept in localStorage when it's available. Each mode saves its neighborhood under its own storage key.

The site chat bridge works like the other modules: the page answers `{type:'tl-host'}` with `{type:'tl-room', code}` and joins automatically from `?room=`.

URL flags: `?webgl` forces WebGL2, `?noao` turns off GTAO, and `?norender` runs the simulation without drawing (for headless tests).

## Colyseus server (optional)

```sh
cd modules-src/maplestreet/colyseus-server && npm install && npm run dev   # ws://localhost:2567
```

It isn't deployed. Online rooms over PeerJS need no backend.
