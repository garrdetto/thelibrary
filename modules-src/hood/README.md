# The Hood

A shared street of player-owned houses (module id `hood`). Each signed-in member can move one household into an empty lot, build and furnish the house, and look after up to four residents with six needs. Everyone on the street, guests included, can walk into any yard; going inside takes the owner being home and answering the knock.

## Scenes

Only one detailed lot is ever loaded. The street view (`src/scene/StreetMode.ts`) shows every house as a roofed shell built from the public `shell` each lot saves (walls, openings, yard floors and yard objects, never the interior). Entering a lot (`src/scene/LotMode.ts`) disposes the street scene and builds that lot in full, plus the other houses' shells and the street around it. Leaving disposes the lot and rebuilds the street.

## Authority

`shared/Room.ts` is the single authority for a lot: Sims, needs, the utility-AI autonomy, interaction queues, chat, knocking and the guest list, build/buy validation (`shared/Build.ts`), speed and settings. It runs:

- in the lot's Durable Object `HoodLot` (`src/server/hood-lot.ts`, binding `HOOD_LOT`, one per `<street>:<lot>`), which loads the lot from D1 `hood_lots`, ticks at 10 Hz, sends state at 5 Hz and saves back to D1;
- in the page for the practice lot (`src/net/Link.ts` `LocalLink`, `?solo=1`), which is never saved.

Keep rules in `shared/`, never in `src/`. `shared/` must stay renderer-free and deterministic (seeded `Rng`), so `tests/rules.test.ts` (`node scripts/hood-tests.mjs`) can run it.

### Visiting rules

- The yard is open to everyone unless the owner turns it off; blocked people cannot join.
- Inside tiles are those the outdoors cannot reach without crossing a wall (`LotGrid.computeInside`). Visitors' paths exclude them and doors stay shut to them.
- A visitor knocks at an exterior door. If the owner is connected to their own lot, they get a prompt (Let in, Always let in, Not now); otherwise nobody answers. A knock waits `KNOCK_SECONDS` real seconds.
- Guests may use seats, TV, bathroom and served food; fridge, beds and shower need the owner's "Guests may use the fridge, beds and shower" setting; the stove and computer are household only.
- When the owner leaves, the guest list clears and guests are walked out to the yard.
- People still in the yard never receive interior objects, floors or Sims inside (`Room.lotView`, `Room.broadcastState`).
- Building waits until no visitor is in the area it changes: inside edits need no guests inside, yard edits need an empty yard.

### Visiting Sims

A member with a home visits with one of their own Sims. The visited lot's object borrows it from the home lot's object (`/depart`), and hands it back with its needs and the sim minutes it spent away when the visitor leaves (`/return`); the rest of the household catches up on its own. A Sim left marked away comes home when its owner next opens their own lot.

## House customization

The exterior designer (Build → Exterior design, `src/ui/StylePanel.ts`) edits the lot's `style` (`shared/Style.ts`, applied with the `style` build step; cladding changes cost per outside wall face, everything else is free):

- Ready-made looks: classic colonial, brick craftsman, modern farmhouse, mid-century, coastal cottage, desert stucco, urban flat.
- Main siding and a lower wainscot (none, quarter, third or half height) in lap siding, board and batten, cedar shake, brick, stacked stone, stucco or modern panel, each in any of 28 paints, with a trim band where they meet; stone, brick or concrete foundation.
- Trim color and width, corner boards, window grids (cross, colonial, prairie), shutters (raised panel, louvered, board and batten) in any paint, flower boxes under the windows.
- Door style (raised panel, craftsman, full glass, farmhouse, modern) and color, lanterns beside outside doors that light at night.
- Roof shape (hip, gable with sided gable ends, flat with a deep fascia), roofing (asphalt shingle, standing-seam metal, clay tile, slate), color, pitch, overhang and gutters; inside wall color.

Features (`features` in the lot, `feature`/`unfeature` build steps, drawn by `src/models/Features.ts`): canopies over doors and windows (shed, gable, arched, flat modern, striped awning; three widths), porch roofs on square, round or tapered craftsman posts that tuck under the main eave, pergolas with string lights, fences (picket, privacy, wrought iron, split rail) with gates Sims can walk through while fences block them, and brick chimneys through the roof. Patios and decks use the outdoor floors (cedar deck, brick pavers, flagstone, poured concrete, pea gravel, patio stone).

## Rendering

three.js WebGPU with WebGL2 fallback through `engine/`. Procedural canvas textures (`src/models/Textures.ts`) are laid out in world metres by node materials (`src/models/Surfaces.ts`): lap siding, plaster, stone footings, shingles, planks, tile, carpet, pavers, grass with large-scale variation, asphalt, concrete, fence boards, bark, leaves, wood grain and fabric (triplanar on furniture). Houses (`src/models/House.ts`) are instanced wall faces with trim, shutters, panelled doors, steps and a hipped roof generated from the inside tiles with eaves. The active lot gets instanced, wind-swayed grass tufts (`src/models/Grass.ts`; still under reduced motion). Walls show up, cut away or down; visitors outside always see them up with the roof on.

## Server

- `/api/hood` (`src/server/routes/hood.ts`): GET a street (`?street=`), POST `claim` to move in, WebSocket upgrade to walk onto a lot (`?street=&lot=&sim=&guest=`).
- D1 `hood_lots` (migration 0023, also created on first use): one row per household with the full `state`, the public `shell`, and `home`/`visitors` presence refreshed by the lot's object.
