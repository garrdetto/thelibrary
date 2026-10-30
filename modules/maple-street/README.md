# Maple Street (source)

Source for `modules/maple-street/public/maplestreet.html` (served at `/modules/maplestreet.html`), a 3D neighborhood simulation. You pick a plot on the town map, build and furnish a house with Sims-style Build and Buy tools, and drive around town. There are lawns to mow, deliveries to haul, shops and a gas station downtown, and a bank with a capped loan. Everyone shares one persistent world, so you can come and go as you please.

The published page has no build step at runtime. three.js r172 (WebGPU with automatic WebGL2 fallback), Rapier 0.14 (`@dimforge/rapier3d-compat`, with `await RAPIER.init()` before the loop starts), PeerJS 1.5.4 and colyseus.js 0.15.28 all load from unpkg through the import map and script tags in `index.html`. The TypeScript in this folder is bundled into the page's inline module script.

## Rebuild

```sh
bun modules/maple-street/build.mjs
# or, without Bun:
pnpm add -D esbuild && node modules/maple-street/build.mjs
```

Edit the TypeScript and `index.html`, not the generated page. This folder is excluded from the site `tsconfig.json`, so its bare imports (`three/webgpu`, Rapier) don't affect the site's type check.

## Controls

| Live mode | |
| --- | --- |
| WASD | Walk, or drive. S brakes and then reverses, and Space is the handbrake. |
| Click | Walk to the spot. Clicking a vehicle, shop door or usable item at home walks you there and uses it. |
| Arrow keys | Orbit (← →) and tilt (↑ ↓) the camera. Right-drag also orbits. |
| E / F / T / R | E gets in or out, shops or uses an item. F fills up at a pump, or calls a tow when the tank is empty. T hitches the trailer, and R flips a vehicle upright. |
| M / B / J | M opens the town map, B opens Build and Buy mode, and J takes a delivery job. |

**Build mode** follows The Sims 4:

- **Build tab:** rooms; full and half walls; picket, privacy and railing fences; 10 floors; wall finishes (paint one side, or Shift-click to paint the whole room); doors, windows and picture windows; gable, hip and flat roofs plus Auto-roof; pools; stairs; buying a lot.
- **Buy tab:** about 60 items. Browse by room or by function. Thumbnails are rendered from the real models, and swatches recolor items.
- **Placing items:** `,` and `.` rotate. Wall décor snaps to the nearest wall.
- **Tools:**
  - Move (H), Eyedropper (E), Design tool (R) and Sledgehammer (K)
  - Undo/redo with Ctrl+Z / Ctrl+Y
  - Levels with PageUp/PageDown
  - Walls up, cutaway or down with Home
- **Money:** everything refunds 100%.

## World and economy

- **Lots:** 20 lots of 32 × 40 m on a residential ring. Six of them come with furnished starter houses (`shared/Seed.ts`), and simulated drivers and walkers move around them (`shared/Npc.ts`).
- **Downtown** (`src/world/Downtown.ts`):
  - Maple Motors: buy vehicles, or take a free test drive.
  - Corner Diner, Bean There Café and Fresh Market: groceries become home-cooked meals at your fridge.
  - Maple Hardware: permanent upgrades.
  - The Savings & Loan.
  - Gas & Go, with four pumps.
- **Needs** (hunger, energy, fun) drop only while you're in town. Your bed, fridge, grill, tub and other items refill them.
- **Vehicles:**
  - You start with a pickup, a trailer and a riding mower.
  - The dealer sells a heavy-duty crew-cab pickup, a muscle coupe, a sedan, a golf cart, a four-wheeler and a zero-turn mower. These are original designs.
  - Fuel burns as you drive and is saved with your account.
  - Drivers sit visibly in the seat, both your own and other players'.

`shared/RoomLogic.ts` is the single authority. It handles:

- lot ownership (you can never edit another player's lot)
- build validation
- batched build gestures, applied in order (`{t:'builds'}`)
- money and the $50,000 loan cap
- interest, charged only on days you're present
- mowing pay and delivery checks
- shop, pump and item proximity checks
- fuel levels, which client reports can only lower

## Connection modes

| Mode | How | Authority |
| --- | --- | --- |
| Shared world (default) | "Enter Maple Street", `?world=1` or `?room=WORLD` | Durable Object `MapleStreetWorld` (`src/server/maplestreet-world.ts`), state in D1 `maplestreet_world` |
| Solo (Local Offline Simulation) | "Explore solo", `?solo=1` | `src/net/Host.ts` in the page |
| Online room | "Host a room" gives a 6-letter code; others join with it or `?room=CODE` | the host's browser (`PeerTransport`), up to 8 neighbors |
| Same-device tabs | More options → Same-device tabs | the tab holding the Web Lock (`LocalTransport`) |
| Colyseus | More options → server URL, or `?server=wss://…` | `colyseus-server/` (Node) |

In the shared world:

- Signed-in members are identified by their session, and guests by a random key kept in the browser.
- New neighbors pick a plot on the overview map. Returning ones start on their own driveway.
- If anything online can't be reached, the module falls back to the offline simulation and shows a notice.

URL flags: `?webgl` forces WebGL2, `?noao` turns off GTAO, and `?norender` runs the simulation without drawing (for headless tests).

## Colyseus server (optional)

```sh
cd modules/maple-street/colyseus-server && npm install && npm run dev   # ws://localhost:2567
```

It isn't deployed. The shared world runs on the site's Worker, and online rooms over PeerJS need no backend.
