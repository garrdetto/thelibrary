# Fox Lake — performance and leak check

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

**Bottlenecks left (next steps):**
- Draw count in town: the town still has about 3,000 small static meshes (per-material chunks, per-cell houses). A selection octree over the town's frozen meshes, or merging chunks across materials, would cut per-frame mesh checks further.
- The night view adds the street lamp pool on top of the moon shadows.
- The lake country with the town in view (the seam) draws both. A lower far LOD for the town skyline would help there.
- The spec's budgets (16.7 ms p95 on high) are for a visible window on the reference desktop and have not been measured there yet. In this harness Fox Lake runs about 1.5–3× standalone Rack & Reel's frame time, so it is not at budget yet.
