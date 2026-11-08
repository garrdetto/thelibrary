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

## The town and its jobs

Both ends of every street's road hold a small town (`shared/Town.ts`, drawn by `src/models/TownBuildings.ts`): east are the Hood Police Department, Fire Station 7, Hood General Hospital, the City Works yard, Greenline Lawn Co. and Kettle Ridge Correctional; west are Hood Fuel & Go, Sunny Side Burgers and Hood Springs Resort with its pool, lodge, cabins and lake.

### Always running

`shared/TownSim.ts` is the whole town as a pure function of the street number, the real clock and the street's service calls. Nothing ticks on a server, so the town keeps working with nobody watching, every page draws the same vehicles in the same places, and the lot's Room can check a worker's answer to a call without trusting the page.

- Routines on fixed periods: Car 1's patrol with speed traps, drive-thru lunches and fuel stops; the trash route lot by lot; Greenline 1 mowing every yard in turn (each lawn's grass height follows when it was last mowed, and the lot view grows and cuts its tufts to match); Sunny Side deliveries; the resort shuttle picking up neighbors and off-duty crews; a fuel tanker refilling Hood Fuel; the Kettle Ridge bus taking an inmate work crew out with a guard and a City Works crew chief; bucket-truck streetlight repairs.
- An emergency may start every `SLOT_SECONDS` (240 s): house or brush fires (Engine 1, Car 2 for traffic and Medic 1 standing by, sometimes taking a hurt firefighter to the nurses), medical calls (Medic 1 to the house, the nurses at the emergency bay and triage, sometimes Engine 1 assisting), arrests (Car 2 to a house, the restaurant, the gas station or the resort, then to Kettle Ridge where a guard books the suspect and walks them to a cell), two-car crashes with wrecks in the road, fuel spills at Hood Fuel, prison yard fights (Medic 1 takes the inmate to Hood General with a guard escort) and pool accidents at the resort.
- Service calls from households go to their own responders (Car 3, Engine 2, Medic 2, the second delivery car, Greenline 2, City Pickup 9, the resort van), queued per vehicle (`serviceJobs`), so an order's arrival time (`serviceEta`) is known when it is placed.

### Careers

`shared/Jobs.ts` holds ten careers: Police Officer, Firefighter, Lawn Care Tech, Prison Guard, Resort Manager, City Worker, Gas Station Clerk, Fast Food Crew, EMS Paramedic and Nurse, each with five titles, pay per shift, a uniform and four tasks, some of which work alongside another job. A resident takes a job from the job board, then goes to work: the Sim leaves the lot for a `SHIFT_SECONDS` (five minute) shift on the real clock. During the shift the owner picks tasks (repeats are worth less) and answers live calls that `callsAt` lists for that job (a fire for firefighters, a booking for guards, a patient for nurses, a fuel delivery for the clerk, the work crew for guards and City Works, a lunch run for the fast food crew, and every household service call for its trade), which pay a bonus. At the end the household is paid by title and performance, the shift wears the Sim out by the job's costs, experience counts toward the next title, and the Sim walks home. Residents on a shift appear at their workplace, or at the call they are answering, for everyone on the street (`shell.workers`).

### Services

From the lot, the owner can ask the police for a patrol check, the fire station for a smoke alarm check, EMS for a wellness check (needs under 25 go back to 45), order burgers (everyone at home eats), book a mowing, report a pothole, or send a resident to Hood Springs for a resort day (back four minutes later rested and happy). The call goes into `hood_requests`, the responder's truck drives out to the curb, and the effect lands when it arrives. Free calls have a ten minute cooldown; a household can have one order of each kind on the way.

## Rendering

### Blender models

Residents and furniture are built in Blender by scripts in `tools/`, then optimized by the asset pipeline:

```
blender -b -P modules-src/hood/tools/build-sim.py        # assets-src/models/hood/sim.glb
blender -b -P modules-src/hood/tools/build-furniture.py  # assets-src/models/hood/furniture.glb
pnpm assets                                              # public/models/hood/*.glb (commit both)
```

Set `HOOD_PREVIEW=/tmp/prefix` on either script to also render Cycles previews.

- **Residents** (`sim.glb`, `src/models/SimFigure.ts`): one skinned adult, about 1.78 m and 7.6 heads tall before the Sim's height scale, with a sculpted face (brow, sockets, cheekbones, nose, lips, ears, lidded eyes with iris and pupil), hands with thumbs, a crew-neck tee, belted trousers and sneakers. Morph targets `Feminine`, `Slim` and `Broad` follow the Look's `body` and `build`; hair meshes `Hair_short`, `Hair_long`, `Hair_bun` and `Hair_curly` follow `hairStyle` (bald shows none). Material slots (`Skin`, `Lips`, `Top`, `Bottom`, `Belt`, `Buckle`, `Shoes`, `Sole`, `Eye`, `Iris`, `Pupil`, `Brows`, `Hair`) are recoloured from the Look. Each figure is a `SkeletonUtils` clone posed every frame by `setPose`: a rotation in the body's own frame is turned into each bone's local rotation from its rest pose, so walking, sitting, lying and busy gestures match the old joint angles. Joint heights match the old figure (hips pivot at 0.90 m).
- **Furniture** (`furniture.glb`, `src/models/Furniture.ts`): one root node per catalog id, one merged mesh each, with bevelled edges, puffed cushions, lathed and swept parts. Slots such as `wood_color`, `cloth_accent`, `gloss_color` or `metal_accent` take the catalog item's colours and the module's procedural wood grain and fabric; fixed slots (`chrome`, `glass`, `screen`, `porcelain`, `book_0`…) have set finishes (`slotMaterial`). The same file's `tree` is also used for the street trees (`buildTree`). The desk chair seats Sims facing the screen (`seatFacesObject`).
- Both load once at boot (`src/models/Models.ts`). If either fails, or with `?sims=0` / `?props=0`, the older procedural figure and furniture are used.


three.js WebGPU with WebGL2 fallback through `engine/`. Procedural canvas textures (`src/models/Textures.ts`) are laid out in world metres by node materials (`src/models/Surfaces.ts`): lap siding, plaster, stone footings, shingles, planks, tile, carpet, pavers, grass with large-scale variation, asphalt, concrete, fence boards, bark, leaves, wood grain and fabric (triplanar on furniture). Houses (`src/models/House.ts`) are instanced wall faces with trim, shutters, panelled doors, steps and a hipped roof generated from the inside tiles with eaves. The active lot gets instanced, wind-swayed grass tufts (`src/models/Grass.ts`; still under reduced motion). Walls show up, cut away or down; visitors outside always see them up with the roof on.

## Server

- `/api/hood` (`src/server/routes/hood.ts`): GET a street (`?street=`), POST `claim` to move in, WebSocket upgrade to walk onto a lot (`?street=&lot=&sim=&guest=`).
- D1 `hood_lots` (migration 0023, also created on first use): one row per household with the full `state`, the public `shell` (including residents on a shift), and `home`/`visitors` presence refreshed by the lot's object.
- D1 `hood_requests` (migration 0024, also created on first use): service calls by street, lot, kind, household name and time. `GET /api/hood?street=&town=1` returns the last hour of them plus the residents on a shift; the lot's object reloads them every 20 seconds and hands them to its Room.
