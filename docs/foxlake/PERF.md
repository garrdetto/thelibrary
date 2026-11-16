# Fox Lake (Life Sim) — performance and leak check

## 2026-11-16 (later): tailored people, Standard detail, memory pass

Same probe (`node scripts/foxlake-perf.mjs`, Standard detail, the new default) after the tailored characters, hairstyles
and the memory fixes listed in `modules-src/foxlake/README.md` (Memory):

| | Result |
| --- | --- |
| JS heap after GC, Main Street / downtown / lake / houses / country / night | 226 / 228 / 228 / 230 / 234 / 234 MB |
| Leak laps (4 × Main Street → country → houses → lake) | flat: heap 234–235 MB, 10,050–10,057 meshes, 230 materials, 206 textures, 9,768 geometries |
| Start button | 7.5 s |
| Page errors | none |

Frame times from this run are not compared with the table below: the PC was running other sessions and builds at the
time, and headless timings swing 2–4x with load.

## 2026-11-16: load, flashing, frame rate and memory

Measured with `node scripts/foxlake-perf.mjs` (Chrome, headless, WebGPU on a Windows desktop GPU, 1280 × 720, `?solo=1`, files served locally, so download time is not in these numbers) and `node scripts/foxlake-flicker.mjs`. Headless timings are noisy and this PC was shared with other work: the before run may have been slowed by load, so the side-by-side figure below (same page, same moment) is the trustworthy one for frame time.

| | Before | After |
| --- | --- | --- |
| Map download (gzip) | 23.5 MB, revalidated every visit | 16.2 MB, cached for a year |
| Street fixes on every load | about 2.8 s of script | none (done at build time) |
| Start button shows | 10.7–35 s | 6.8 s |
| Montello finished building after play starts | 26–206 s (longest single freeze 1.7–5.5 s) | 15 s (longest slice about 1 s) |
| Mesh selection per frame (same page, A/B) | 13–15 ms | 5–7 ms |
| Frame p50, Main Street / downtown / lake / houses / country | 47 / 44 / 30 / 26 / 26 ms | 12 / 10 / 7 / 8 / 9 ms |
| JS heap after GC, town built | 367–376 MB | 231–239 MB |
| Leak laps (4 × Main Street → country → houses → lake) | flat | flat |
| Picture change per 0.1° turn, houses | 1.2–6.5 %, spiky | 1.08 %, steady |

### Why buildings flashed, and what fixed it

- **Depth fighting.** Storefront glass, brick panels, trim and foundations sit 1–5 cm in front of the walls behind them. With the near plane at 8 cm, the ordinary depth buffer could not tell surfaces that close apart beyond about 100–150 m, so whole triangles of facade and door glass swapped as the camera moved. Fox Lake now draws with a reversed depth buffer (`GameOptions.reverseDepth`, `rackreel/core/EngineSetup.ts`), which keeps millimetre precision to the horizon. It needs `shadows: false` (the cached shadow layer writes depth itself), which Fox Lake already has; the sky shader pins itself to the far plane the reversed way (`REVERSE_DEPTH`).
- **Popping at the fog's edge.** Town cells, ground chunks and tree stands were switched off at 640 m, where the day fog still lets about 9 % of a building through. They now switch at 860 m (about 1.5 %), `CULL_REACH` in `town/FoxLakeTown.ts`.
- **Decals tested for view at the wrong place.** Lot, field and court paint froze its bounds before it was hung under the moved, mirrored town root, so Babylon kept culling it at the wrong angles (`tello/world/Decals.ts`). An audit of all 9,065 frozen meshes now finds none whose bounds disagree with where it is drawn.
- **Light changes recompiling every shader.** The sealed lake country's two cabin lamps were lit in every Montello material (two extra point lights per pixel), and bowfishing switched them off and on, which recompiled every shader in town and blanked it for a moment. Fox Lake removes them (`SEALED_LIGHTS`).

### Faster loading

- `lake/MapPack.ts` + `tools/bake-map.ts` (run by the module build) store Montello's map with its streets already fixed, the grids as differences from their neighbours (ground 12.5 → 6.9 MB packed), under hashed names in `public/modules/foxlake-map/`. `tests/map-pack.test.ts` checks it builds exactly the same land, lake site and start. The World Editor's edits and the move to Lake Montello's level still run in the page, on the surveyed heights.
- The grid file is unpacked into one buffer of its final size instead of chunks plus a joined copy, and the rebase rewrites the ground and water grids in place (they were held twice: 67 MB).
- PeerJS is imported only when a hunting party is hosted or joined: its import-time WebRTC check took about 1.4 s.
- Bridge decks are found through a 32 m grid instead of a scan of every bridge on every height lookup (`TelloLand.deckAt`).

### Higher frame rate

- `core/RegionCuller.ts` hands Babylon each frame's draw candidates itself: every mesh it does not manage, plus the meshes of groups that are on and whose bounding sphere is in view. Babylon used to walk all ten thousand meshes every frame, switched off or not.
- New materials are made without Babylon's look through every mesh for each property set (`fp/core/Tex.ts` `pbr`), and the night glow is set as a uniform (`Mats.setNight`), so dusk and dawn no longer cost a full scan per glowing material every few frames. Both were among the biggest costs while the town built.

### Memory

- The roads, street paint and decals kept about 130 MB of plain number arrays for the session; they are built from typed arrays and dropped once on the GPU (`releaseVertices` in `tello/world/Roads.ts`, once per mesh: a second clear recorded zero indices and broke sorting of see-through meshes).
- Leaks: mesh, material, texture and geometry counts and the heap stay flat over repeated laps across the map.

### Left for later

- About 9,500 meshes remain (7,900 of them Montello's per-cell, per-material chunks). Merging across materials or a far LOD for the skyline would cut draw calls further.
- Montello still builds its geometry in the page after play starts (about 15 s here). Caching the built meshes on the device would make return visits immediate.

## 2026-11-11

Measured 2026-11-11 with `node scripts/foxlake-capture.mjs` (Chrome, headless, WebGPU on a Windows desktop GPU, 1280 × 720, `?solo=1`). Headless timings are noisy (the same spot can move by 30 % between runs) and run slower than a visible window; compare them with each other and with standalone Rack & Reel measured the same way, not with the budgets below.

| Spot | p50 ms | p95 ms | Active meshes | Meshes | Materials | Textures |
| --- | --- | --- | --- | --- | --- | --- |
| Town, Main St (3 PM) | 34.9 | 69.1 | 475 | 3,506 | 187 | 261 |
| Downtown (5 PM) | 22.4 | 50.9 | 266 | 3,516 | 191 | 264 |
| County road | 22.5 | 42.6 | 188 | 3,330 | 160 | 246 |
| Lake country edge, looking at town | 37.5 | 56.7 | 503 | 3,350 | 160 | 246 |
| Lake, by the dock (6 PM) | 35.3 | 54.8 | 392 | 3,330 | 160 | 246 |
| Your vehicles, everyday outfit | 24.4 | 40.4 | 391 | 3,442 | 180 | 259 |
| Town at night (9:30 PM, lamps) | 46.6 | 83.9 | 492 | 3,530 | 194 | 269 |
| Standalone Rack & Reel, cabin (same harness) | 15.1 | 31.7 | 196 | 1,443 | | |

**Leaks:** after five round trips town → lake → town, mesh, texture and geometry counts are unchanged and materials within one (0.5 %). The full numbers are in `capture-report.json`.

**What was done:**
- The town costs 0.4 ms of script per frame (physics at 60 Hz, houses, lawns, neighbors). Rendering is the cost: before culling, Babylon checked all 3,543 meshes every frame (about 9 ms headless).
- `core/RegionCuller.ts` switches off town cells and lake-country tree stands more than 640 m away, where the fog has hidden them. That took the town spot from 45.7 to about 31–35 ms and downtown from 35.3 to 22–25 ms.
- The town's static shadows are merged proxies in Rack & Reel's cached shadow layer (redrawn only when the shadow frame moves).
- Static colliders stream in near you and your cars (about 130–200 of 13,718 on at a time).
- Shaders are warmed by Rack & Reel's start-up pass.
