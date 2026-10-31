# Module audit (Phase 0)

Read-only inventory of every playable learning module as of commit `a90bd92` on `main`. No code was changed. Line numbers refer to that commit; for Maple Street they refer to the TypeScript sources in `modules-src/maplestreet/` (the shipped `public/modules/maplestreet.html` is a generated bundle and is not the extraction target).

Scope note: pool, racing/oval and park live inside the React app, not in `public/modules`, so "entry file" for them is the mounted component.

## 1. Module table

| Module id | Entry file | Size | Renderer | Models built from | Physics | Multiplayer path | Leaderboard hook | External CDN loads | postMessage / query-param contracts |
|---|---|---|---|---|---|---|---|---|---|
| `sandlot3d` | `public/modules/sandlot3d.html` | 194,928 B / 2,086 lines | three.js **r128** (`WebGLRenderer`, PMREM sky reflection, custom post quad) + canvas 2D HUD overlay | Inline geometry (`class Rig`, `LimbTube`, `buildWorld` props), canvas-generated textures; roster/batter-card art from `public/modules/sprites/p00–p33.png` (34 PNGs); `faces.png` referenced at L400 but not drawn on models | Custom (inline ball flight, fielding, baserunning) | none | none | `cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`; Google Fonts (Bowlby One SC, Barlow Semi Condensed) | none (receives hub `?name=` but does not read it) |
| `maplestreet` | `public/modules/maplestreet.html` (generated from `modules-src/maplestreet/` by `build.mjs`) | 389,224 B / 9,920 lines (bundle); 84 TS source files ≈ 560 KB | three.js **0.172.0** `WebGPURenderer` (WebGL2 fallback) via import map; canvas 2D for textures, HUD thumbnails and `PlotMap` | Inline geometry in TS: `Furniture.ts` (≈70 catalog builders), `Mesher.ts` (walls/roofs → `BufferGeometry`), `VehiclePresets.ts`, `Downtown.ts`, `Neighborhood.ts`, `Character.ts`, instanced `Grass.ts`; procedural canvas textures in `Materials.ts` | **Rapier 0.14 compat** (`physics/Physics.ts`, `Vehicle.ts`, `Character.ts`) | Default: **Durable Object** `MapleStreetWorld` via `/api/maplestreet` WebSocket; PeerJS rooms (`tl-maplestreet-<6 chars A–Z2–9, no I/L/O/0/1>`); same-device `BroadcastChannel` (`LocalTransport`); optional Colyseus (`?server=`); offline fallback | none | unpkg: `three@0.172.0` (webgpu, tsl, examples/jsm), `@dimforge/rapier3d-compat@0.14.0`, `peerjs@1.5.4`, `colyseus.js@0.15.28` | Posts `{type:'tl-room',code}`; answers `tl-host`; reads `?room=`, `?world=`, `?host=`, `?server=`, `?solo=`; fetches `/api/pool-account` for the signed-in name; `/api/maplestreet` |
| `sandlot` | `public/modules/sandlot.html` | 773,477 B / 3,685 lines | Canvas 2D (4 contexts: field, batting view, portraits, menus) | Procedural 2D drawing (`drawHead`, `drawHat`, `drawBatter3D`, `buildFieldBG`, …); embedded base64 portrait data (file is 773 KB mostly data) | Custom | PeerJS (`sandlot-<6-char code, lowercase>`) | none | unpkg `peerjs@1.5.4` | Posts `tl-room`; answers `tl-host`; reads `?room=` |
| `shorttrack` | `public/modules/shorttrack.html` | 207,471 B / 2,551 lines | three.js **0.160.0** (`WebGLRenderer`, `Sky`, `RoomEnvironment`, `EffectComposer`+`UnrealBloomPass`, `BufferGeometryUtils`) + canvas 2D HUD | Inline geometry: track ribbons (`ribbon`, L452–512 top-level block), `buildCrowd`, `buildTrees`, truck `buildTruck` (owner model embedded as `TM`, L1153–1563), legacy car `buildCarLegacy`; **`.bin`** super late model `public/modules/shorttrack-car.bin` parsed by `parseCarAsset` and skinned by `carLiveryTex`; canvas livery textures | Custom (`CFG`, `aMaxAt`, banking/grip model, AI in-file) | PeerJS (`sts-oval-race-<5 letters A–Z minus I/O>`), host-authoritative | **`/api/racing`** (POST lap with `track`/`mode`; `GET ?records`); posts `{type:'tl-lap',track}` | jsdelivr `three@0.160.0` (+ `examples/jsm/`), unpkg `peerjs@1.5.4`, Google Fonts (20 digit-subset families for race numbers) + `fonts.gstatic.com` | Posts `tl-room`, `tl-lap`; answers `tl-host`; reads `?room=`, `?track=` (`shorttrack`/`dells`/`dellswide`/`dirt`); loads `/modules/shorttrack-numbers.js`, `/modules/shorttrack-car.bin` |
| `botwreck` | `public/modules/botwreck.html` | 53,899 B / 630 lines | three.js **0.160.0** (`WebGLRenderer`, shader sky dome) + one canvas 2D texture helper | Inline geometry (`buildCar`, `staticBox`, `addCrate`, `boxMesh`, `edgeLines`, `ParticlePool`) | **cannon-es 0.20.0** (`RaycastVehicle`, SAP broadphase) | none | `tlScores.submit('botwreck', …)` via `/modules/module-scores.js` → `/api/module-scores`, posts `tl-score-saved` | jsdelivr `three@0.160.0`, jsdelivr `cannon-es@0.20.0` | `tl-score-saved` (via `module-scores.js`) |
| `chess` | `public/modules/chess.html` | 41,785 B / 461 lines | DOM (div board, Unicode glyphs `GLYPH` L264); in-file engine runs in a Web Worker (`self.onmessage`) | n/a (no drawn models) | n/a | PeerJS (`tl-chess-<code lowercase>`) | none | unpkg `peerjs@1.5.4`, Google Fonts (Rajdhani, Inter) | Posts `tl-room`; answers `tl-host`; reads `?room=`, `?name=` |
| `checkers` | `public/modules/checkers.html` | 26,263 B / 273 lines | DOM (div board) | n/a | n/a | PeerJS (`tl-checkers-<6 chars A–Z2–9 minus I/L/O/0/1>`) | none | unpkg `peerjs@1.5.4`, Google Fonts | Posts `tl-room`; answers `tl-host`; reads `?room=`, `?name=` |
| `2048` | `public/modules/2048.html` | 13,082 B / 147 lines | DOM (absolutely positioned tile divs) | n/a | n/a | none | `tlScores.submit('2048', …)` → `/api/module-scores`, `tl-score-saved` | Google Fonts (Rajdhani, Inter) | `tl-score-saved` |
| `helicopter` | `public/modules/helicopter.html` | 12,652 B / 155 lines | Canvas 2D (single context) | Procedural 2D (`drawHeli`, `draw`) | Custom (gravity/lift integrator) | none | `tlScores.submit('helicopter', …)` → `/api/module-scores`, `tl-score-saved` | Google Fonts (Rajdhani, Inter) | `tl-score-saved` |
| `pool` | `src/components/PoolTable.tsx` (+ `PoolLobby.tsx`, `CueArtwork.tsx`, `src/lib/pool-computer.ts`, `pool-effects.ts`, `pool-network.ts`, `cue-design.ts`) | 118,807 B / 1,501 lines (+28 KB lobby, +12 KB libs) | Canvas 2D (table, balls, cue overlay, collision preview) | Procedural 2D (`drawTable`, `drawBall`), cue artwork from `public/images/cues/`, backdrop PNGs `public/images/pool-tower-*.png`; cue overlay images from `/api/pool-cue-overlay` | **matter-js 0.20** (`Engine`, `Bodies`, `Body`, `Composite`, pinned in package.json) | **`server/`** socket.io (`index.mjs`, Railway; ticket from `/api/pool-account?action=ticket`) | none (practice records: `/api/pool-practice`) | none (socket.io-client bundled) | `/api/pool-account`, `/api/pool-practice`, `/api/pool-preferences`, `/api/pool-cue-overlay`, `/api/account-settings`; header `X-Pool-Player`; env `VITE_POOL_SERVER_URL` |
| `racing` / `oval` | `src/components/Racing.tsx` (+ `src/lib/racing.ts`, `server/racing-engine.mjs`) | 62,818 B / 683 lines + 2,985 B + 42,299 B / 638 lines | Canvas 2D (course layer, road texture, car sprites, HUD) | Sprites: `public/images/vehicles/{challenger,escalade,lamborghini,muscle-red,ram}.png`, `stock-car.webp`, recoloured in canvas (`paintedVehicle`, `detailedVehicle`, `stockCarSprite`, `clipartRacecar`); course backdrops `public/images/{max-secure-circuit,oval-speedway}.webp` | **Shared engine** `server/racing-engine.mjs` (also used by the server) | **`server/racing.mjs`** socket.io namespace `/racing` (ticket from `/api/racing`) | **`/api/racing`** (laps, `?records&mode&track`, paint profiles) rendered by `LapRecordBoard.tsx` | none | `/api/racing`; env `VITE_POOL_SERVER_URL`; hub hash `#racing` / `#oval` selects `fixedTrack` |
| `park` | `src/components/park/ParkGame.tsx` (+ `ParkHud.tsx`, `ParkScoreboard.tsx`, `src/lib/park/{gl,models,renderer,session,api}.ts`, `server/park/*.mjs`) | React 78 KB / 925 lines; renderer libs 126 KB / 2,119 lines; shared sim 159 KB / 2,846 lines | **Raw WebGL2** (`gl.ts`: own `MeshBuilder`, shadow map with PCF, instancing) | Inline geometry in `models.ts` (`treeModel`, `addPerson`, `stallModel`, `flatRideModel`, `carModel`, …) and `renderer.ts` (`rebuildStatic`, `trackGeometry`) | **Shared sim** `server/park/` (terrain, coaster track physics, guests, finances) | **`server/park.mjs`** socket.io namespace `/park` (ticket from `/api/park`), server-authoritative command replay | **`/api/park?scores=<scenario>`** (net-worth boards, `ParkScoreboard.tsx`) | none | `/api/park` (saves slots 0–6, tickets, scores); env `VITE_POOL_SERVER_URL` |

### Cross-cutting observations for Phase 1

- Four different Three.js builds are loaded from three different CDNs: r128 (cdnjs, non-module), 0.160.0 ×2 (jsdelivr ESM), 0.172.0 WebGPU build (unpkg). `three` is **not** in `package.json`; no module is served from the Vite build.
- Physics is split five ways: cannon-es (botwreck), Rapier (maplestreet), matter-js (pool), the shared `racing-engine.mjs`, the shared `server/park/`, plus bespoke integrators in sandlot3d, sandlot, shorttrack and helicopter.
- PeerJS room-id prefixes that must be preserved verbatim: `sandlot-` (6 lower-case), `tl-chess-` (lower-case), `tl-checkers-` (6 upper-case), `sts-oval-race-` (5 upper-case letters), `tl-maplestreet-` (6, lower-cased on the wire).
- The hub (`src/routes/index.tsx` L416) appends `?name=<username>&room=<code>` to every embedded module src and drives invites with `postMessage({type:'tl-host'})` → `{type:'tl-room',code}` (L191–195). `ModuleScoreboard.tsx` L38 listens for `tl-score-saved`; `LapRecordBoard.tsx` refreshes on `tl-lap`.
- Google Fonts are loaded by six modules (visible-text fonts and the Short Track race-number digit subsets).
- Pre-existing console error on `main`: `maplestreet.html` loads `colyseus.js@0.15.28` from unpkg, which throws `Uncaught ReferenceError: Buffer is not defined` (`colyseus.js:808`) in the hub iframe. The module still runs (Colyseus is optional), but the error exists before this revamp and should be removed when the Colyseus transport is bundled or dropped in Phase 1.

### Gate baseline (preview build, Playwright, Chromium SwiftShader)

Every embedded module loads inside the hub iframe (`/#module-<id>`). The only console errors are `/api/*` responses (503 with no local D1, 401 when signed out), which are environment-only, plus the Maple Street `Buffer` error above.

## 2. Visual-object builders per module (extraction targets for Phase 2)

Found by scanning for `new THREE.`, `BufferGeometry`, `Mesh(`, `drawImage`, `fillRect` and canvas path/fill calls, then brace-matching each enclosing function. Ranges are inclusive line numbers. "Hits" is the number of such calls inside the function.

### sandlot3d — `public/modules/sandlot3d.html` (three r128)

Scene setup is top-level at L306–333 (`renderer`, `scene`, `camera`, post quad L314–326, `resize`).

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 340–341 | `ballTex` | canvas ball texture | 3 |
| 344–349 | `ENV` | PMREM sky environment scene (sky mesh, hemisphere) | 19 |
| 471–495 | `headTexture` (+`seqLen` helper) | canvas face/skin texture → `CanvasTexture` | 26 |
| 522–537 | `jerseyTexture` (+`word` L530) | canvas jersey texture | 11 |
| 538 | `pantsTexture` | canvas | 2 |
| 539–540 | `logoTexture` | canvas | 2 |
| 544–550 | `STD`, `SKIN`, `HAIR`, `GLOSS` | PBR material factories | 12 |
| 551–552 | `lathe` | `LatheGeometry` helper | 3 |
| 567–571 | `hairCap` | hair geometry | 2 |
| 573 | `skullPatch` | geometry | 2 |
| 577–581 | `ringGrid` | ring `BufferGeometry` | 5 |
| 602–616 | `hand` | hand meshes | 17 |
| 617–627 | `fieldersGlove` | glove meshes | 9 |
| 628–639 | `cleat` | cleat meshes + canvas sole | 18 |
| 642–675 | `class LimbTube` (`constructor` L643, `update` L660) | continuous arm/leg tube `BufferGeometry` | 8 |
| 703 | `head` | head geometry | 2 |
| 709–901 | `class Rig` | whole athlete: `constructor` L710, `buildAbdomen` L754, `updateAbdomen` L760, `face` L766, `buildHair` L789, `buildFacialHair` L800, `buildHeadwear` L808 (+`bill` L814), `setHeadwear` L826, `paintHead` L828, `dressFor` L831, `setLook` L840, animation `play`/`snapshot`/`drive`/`mirrorState`/`apply` L847–901 | 75 |
| 903–904 | `dropGeo`, `rigFor` | disposal / rig cache | – |
| 915–951 | `buildWorld` | field, lights, sky dome, fog, ballpark selection | 33 |
| 953–958 | `clouds` | cloud sprites | 5 |
| 959–966 | `hills` | background hills `BufferGeometry` | 8 |
| 967 | `noiseCanvas` | noise texture | 2 |
| 968–972 | `ground` | ground plane | 6 |
| 975–1038 | `fieldSurface` (+`onL` L1023, `stripes` L1039) | canvas infield/outfield texture + plane | 51 |
| 1041–1056 | `basesAndChalk` (+`plateGeo` L1050) | bases, plate, foul lines | 31 |
| 1059–1064 | `ribbon` | outfield-wall ribbon geometry | 5 |
| 1065–1075 | `wallTexture` | canvas | 23 |
| 1076–1100 | `wall` | outfield wall, pads, foul poles | 39 |
| 1103–1111 | `trees` | instanced trees | 17 |
| 1112–1149 | `stands`, `lineStandPath`, `sideStand`, `ofPath` | grandstand path geometry | – |
| 1127–1140 | `crowd` | crowd instanced meshes | 13 |
| 1150–1154 | `backstop` | backstop net | 13 |
| 1155–1160 | `dugout` | dugouts | 23 |
| 1161–1166 | `board` | scoreboard mesh | 19 |
| 1167–1186 | `drawBoard` (+`dot` L1183) | canvas scoreboard texture | 15 |
| 1188–1222 | `sandlotProps` | sandlot park props | 70 |
| 1223–1228 | `lawnChair` | prop | 13 |
| 1229–1233 | `picnicTable` | prop | 7 |
| 1234–1243 | `house` | prop | 33 |
| 1244–1261 | `parkProps` | park ballpark props | 29 |
| 1262–1318 | `domeProps` (+`gR` L1276, `pos` L1285, `panel` L1289) | dome ballpark (roof panels, catwalks) | 116 |
| 1320–1347 | `stadiumProps` | stadium ballpark | 28 |
| 1521–1524 | `pitchPos` | vector math | 2 |
| 1803–1805 | `faceTo`, `dropBat` | runtime bat mesh | 4 |
| 1859–1874 | `ballTick` | ball motion (vectors) | 3 |
| 1878–1882 | `catcherCam` | camera | 6 |
| 1901–1978 | HUD: `zoneFrame`, `hudTick`, `pitchMeter`, `drawGhost`, `drawBaseTargets`, `drawTags` (+`tag` L1975) | canvas 2D HUD overlay | 58 |

### maplestreet — `modules-src/maplestreet/` (three 0.172.0 WebGPU, Rapier)

Already modular TypeScript; Phase 2 mainly needs to move these into `modules-src/maplestreet/models/` factories and pull constants into `config.ts`.

| File | Lines | Function / class | Builds | Hits |
|---|---|---|---|---|
| `src/build/Furniture.ts` | 12–17 | `mat` | material cache | 3 |
| | 19–31 | `C`, `NIGHT_GLOW_MATERIALS` | shared material palette | – |
| | 34–45 | `box`, `cyl`, `ball` | primitive helpers | 12 |
| | 46–71 | `legs`, `cushionSofa`, `bedFrame`, `plantBlob` | composite helpers | – |
| | 73–287 | `BUILDERS` record (≈70 entries: `sofa` L75 … `divingBoard` L272, `doghouse` L281; `painting` L194 draws a canvas) | every furniture / yard catalog item | – |
| | 289–300 | `buildFurniture` | public factory | – |
| `src/build/Mesher.ts` | 40–63 | `class Soup` (`tri`, `triUp`, `quad`, `build`) | wall/roof triangle soup → `BufferGeometry` | 10 |
| | 67–481 | `class StructureMesher.build` (nested `addBox` L83/329/377, `collide` L330, `push` L376/438, `doorLeaf` L357) | walls, floors, roofs, doors, pool shells, colliders | ~30 |
| `src/build/Thumbs.ts` | 14–91 | `class ThumbnailRenderer` | offscreen renders → canvas thumbnails | 19 |
| `src/build/BuildController.ts` | 44–73 | `changed` | ghost/preview meshes | 8 |
| `src/core/Materials.ts` | 41–291 | 22 canvas texture painters (`siding`, `brick`, `stone`, `planks`, `tile`, `slate`, `concrete`, `shingles`, `grass`, `bark`, `leaves`, `stripes`, `damask`, `subway`, `panel`, `herringbone`, `marble`, `deckBoards`, `pavers`, `fenceWood`, `poolTile`, `grassBump`) | procedural textures | 62 |
| | 295–379 | `class MaterialLibrary` (+`T` L319) | `MeshStandardMaterial` cache | 23 |
| | 385–400 | `worldBoxUV` | UV remap | 3 |
| `src/core/Merge.ts` | 11–69 | `slice`, `normalized`, `mergeStatic` | static geometry merge | 11 |
| `src/core/Engine.ts` | 22–100 | `class Engine` | renderer/scene/camera | 3 |
| `src/game/CameraRig.ts` | 10–62 | `class CameraRig` | camera | 5 |
| `src/game/PlotMap.ts` | 15–175 | `class PlotMap` | canvas 2D town map | 24 |
| `src/net/RemoteEntities.ts` | 47–57 | `nameSprite` | canvas name tag sprite | 9 |
| | 59–177 | `class RemoteEntities` | remote avatars/vehicles | 4 |
| `src/physics/Character.ts` | 13–83 | `class Avatar` (+`add` L25) | player body meshes | 32 |
| `src/physics/VehiclePresets.ts` | 44–57 | `M` | material palette | – |
| | 58–67 | `makePaint`, `makeLights` | materials | 6 |
| | 69–101 | `box`, `cyl`, `lampPair`, `profile`, `arch` | primitive helpers (`ExtrudeGeometry` from `Shape`) | 13 |
| | 104–117 | `buildWheel` | wheel group | 13 |
| | 121–406 | `PRESETS` (`truck` L122, `sedan` L163, `golfcart` L197, `atv` L222, `mower` L247, `hdtruck` L271, `coupe` L317, `zeroturn` L356, `trailer` L385; each has a `build` method) | vehicle bodies | 37 |
| `src/world/DayNight.ts` | 15–170 | `class DayNight` (`initSky` L58, `updateEnvironment` L144) | sun/moon/sky, stars | 21 |
| `src/world/Downtown.ts` | 17–55 | `facadeTextures` | canvas | 15 |
| | 57–67 | `signTexture` | canvas | 3 |
| | 74–273 | `class Downtown` (`building` L89, `gasStation` L150, `depot` L205, `streetscape` L214, `showroomCars` L244) | downtown block | 154 |
| `src/world/Grass.ts` | 27–54 | `clumpGeometry` | grass clump `BufferGeometry` | 6 |
| | 58–151 | `class Grass` (`layout` L102) | `InstancedMesh` grass | 12 |
| `src/world/Lawn.ts` | 19–122 | `class Lawn` (`paintUncut` L55, `mow` L65) | per-lot canvas mow texture + plane | 13 |
| `src/world/Neighborhood.ts` | 21–30 | `labelTexture` | canvas | 3 |
| | 32–316 | `class Neighborhood` (`buildGround` L60, `slab` L84, `buildRoads` L100 (+`paint` L107, `strip` L109), `buildLots` L126, `buildTrees` L181, `buildLamps` L254) | terrain, roads, lots, trees, lamps | 95 |

### sandlot — `public/modules/sandlot.html` (canvas 2D)

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 1454–1465 | `limb`, `blob` | 2D limb primitives | 14 |
| 1539–1566 | `drawHairBack`, `drawHairFront` (+`cap` L1555) | hair | 48 |
| 1567–1575 | `drawCap` | cap | 8 |
| 1576–1623 | `drawHead` | face | 40 |
| 1646–1664 | `drawShoe` | shoe | 25 |
| 1667–1817 | `drawTopDetail` (+`vNeck`, `lapels`, `buttons`, `band`) | jersey/costume top | 142 |
| 1820–1832 | `drawCoatSkirt` | costume | 12 |
| 1835–1944 | `drawHat` (+`dome` L1838) | hats | 108 |
| 1947–1967 | `drawCostumeHead` | costume heads | 27 |
| 2050–2059 | `drawProp` | held props | 17 |
| 2068–2077 | `drawPortrait` | roster portrait composite | 4 |
| 2135–2296 | `drawBatter3D` (+`limb3`, `shoe`, `arm`) | pseudo-3D batter | 74 |
| 2306–2333 | `clouds`, `lightTower` | backdrop pieces | 9 |
| 2335–2412 | `drawBackdrop` | stadium backdrop | 113 |
| 2415–2438 | `drawDomeRoof` | dome | 28 |
| 2439–2511 | `buildBattingBG` (+`panel`, `poly`) | cached batting background | 69 |
| 2512–2532 | `drawTreeB`, `drawTowerB`, `drawCarB` | background props | 20 |
| 2533–2598 | `drawBattingView` | batting camera frame | 21 |
| 2601–2626 | `drawSausageRace`, `drawDugout` | side show, dugout | 13 |
| 2638–2717 | `buildFieldBG` (+`poly` L2688) | cached field background | 77 |
| 2732–2799 | `drawFieldView` | field camera frame | 54 |
| 2800–2814 | `drawBoxObstacleF` | obstacle | 14 |
| 2820–2855 | `outlinedText`, `drawScoreboard` (+`dots`), `drawTicker` | HUD | 24 |
| 2896–2945 | `panel`, `wrapText`, `menuBackdrop`, `drawSetup` | menus | 22 |
| 2995–3069 | `drawDraft` (+`taken`), `drawKidCard`, `drawPregame` | draft screens | 39 |
| 3075–3182 | `drawGameScreen`, `drawAtBatInfo`, `drawPitchMenu`, `drawBox` | in-game HUD | 45 |
| 3317–3340 | `frame` | main draw loop | 2 |
| 3474–3538 | `drawNetHud`, `drawOnline` | online screens | 18 |
| 3626–3661 | `drawSeason` | season screen | 25 |

### shorttrack — `public/modules/shorttrack.html` (three 0.160.0)

Scene setup is top-level at L321–347 (`renderer`, `scene`, `camera`, `pmrem`, `makeSky` L331, `envNight`, `envDay` L335–336, lights, `composer`/`bloom`). Track surface, walls, catch fence, groove texture and grandstand treads are built in **top-level statements** L467–512 (no enclosing function) — this block needs wrapping into a factory first.

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 350–359 | `canvasTex`, `noiseFill`, `rr` | canvas texture helpers | 2 |
| 360–404 | `TEX` table, `smokeTex`, `glowTex`, `tireSideTex`, `skyTex` L393, `SKY_DAY`, `SKY_NIGHT`, `sky` mesh L397, `cloudTex`, `clouds` mesh L404 | sky/cloud textures and meshes (top-level) | ~20 |
| 409–418 | `tileNoise`, `pixelTex`, `normalTex` | procedural textures | – |
| 452–460 | `ribbon` | parametric track-strip `BufferGeometry` | 5 |
| 461 | `addMesh` | add helper | 2 |
| 466 | `lineMat` | line material | 2 |
| 467–477 | *(top level)* | asphalt, apron, yellow/white lines, start line, ground plane, outer wall, wall cap, catch-fence mesh, inner wall | 24 |
| 478–479 | `trackTube` | `TubeGeometry` along track | 6 |
| 480–483 | *(top level)* | fence rails and cables | – |
| 484–491 | *(top level)* | rubber/groove texture (pixel loop) + ribbon | – |
| 493–512 | `ROWS`, `sY`, `treadA/B` + *(top level)* | grandstand treads | 6 |
| 513–585 | `buildCrowd` | instanced crowd | 75 |
| 586–592 | `drawPylon` | canvas scoring pylon | 5 |
| 593–625 | `buildTrees` | instanced trees | 41 |
| 626–653 | `addMark`, `seedMarks` | tire marks | 9 |
| 655–664 | `updSparks` | spark particles | 2 |
| 704–731 | `drawPattern`, `drawNumber`, `drawSponsor` | livery canvas painters | 21 |
| 732–781 | `sideTex` (+`u`), `frontTex`, `rearTex`, `roofTex`, `cabinTex`, `windshieldTex` | truck livery textures | 53 |
| 782–791 | `makeTag` | name tag sprite | 7 |
| 792–815 | `loftGeo` | lofted body `BufferGeometry` | 6 |
| 849–862 | `topTex` (+`vz`) | roof livery | 14 |
| 863–930 | `buildCarLegacy` (+`paint` L865) | legacy car body | 175 |
| 1153–1563 | `buildTruck(THREE, opts)` = `TM` owner race-truck model (helpers `add` L1178, `box` L1179, `tube` L1183, `pathTube` L1190, `fromArrays` L1194, `surfNormal` L1232, `onSurface` L1236, `nosePart` L1326, `tailPart` L1335, `mirrorZ`/`meshPanel` L1341, `oct` L1373, `wheel` L1539) | lofted body, greenhouse, roll cage, fascia, bed wing, wheels | 123 |
| 1564–1586 | `makeGrilleTexture` | canvas | 4 |
| 1587–1616 | `tmSideTex` (+`u`), `tmHoodTex` | truck decal textures | 23 |
| 1634–1637 | `tmGrid` | grid `BufferGeometry` | 5 |
| 1640–1655 | `parseCarAsset` | `.bin` → `BufferGeometry` (+`regions`) | 8 |
| 1656–1691 | `carLiveryTex` (+`centre`, `vcentre`) | car livery atlas (`CAR_NUM_SPOTS`) | 18 |
| 1696–1714 | `buildStockCar` | car from `.bin` + livery | 14 |
| 1715–1744 | `buildCar` (+`decalMat` L1724) | vehicle dispatcher (truck/car), decals | 18 |
| 2209–2223 | `applyQuality` | quality tier (shadow/bloom/pixel ratio) | 8 |
| 2231–2234 | `setFov` | camera | 3 |
| 1566–1636 (HUD) | 6 canvas 2D HUD contexts L1566–1634 area and minimap | HUD | – |

### botwreck — `public/modules/botwreck.html` (three 0.160.0 + cannon-es)

Scene setup top-level L160–192 (`renderer`, `scene`, fog, `camera`, lights, shader sky dome L185–189); physics world L193–202.

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 205 | `link` | body↔mesh sync | – |
| 208–216 | `canvasTexture` | canvas helper | – |
| 217–226 | `staticBox` | arena walls/ramps (mesh + body) | 4 |
| 250–258 | `addCrate` | crate (mesh + body) | 4 |
| 259–278 | `buildCrateField` | crate layout | – |
| 279–306 | `class ParticlePool` | `Points` + `BufferGeometry` particles | 9 |
| 309–320 | `burstSparks`, `puffSmoke`, `fireball` | particle emitters | – |
| 346–347 | `boxMesh`, `edgeLines` | part mesh + edge lines | 11 |
| 359–413 | `buildCar` | robot vehicle (chassis, parts, wheels, `RaycastVehicle`) | 56 |
| 414 | `shadeHex` | colour helper | – |
| 453–468 | `breakWheel` | detached wheel mesh/body | – |
| 470–494 | `processExplosions` | explosion meshes | 4 |
| 584–603 | `followCamera` | camera | 6 |

### chess / checkers / 2048 — DOM only

No drawn visual objects. Board squares and pieces are `div` elements (`chess.html` glyph table `GLYPH` L264, board paint L330–341; `checkers.html` board rebuild L191–235; `2048.html` tile divs L65–76). Nothing to extract for Phase 2 beyond CSS.

### helicopter — `public/modules/helicopter.html` (canvas 2D)

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 91–102 | `drawHeli` | helicopter sprite | 15 |
| 103–133 | `draw` | cave, blocks, particles, HUD | 23 |

### pool — `src/components/PoolTable.tsx` (canvas 2D + matter-js)

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 84–87 | `tracePocket` | pocket path | 2 |
| 191–193 | `circle` | helper | 2 |
| 195–275 | `drawTable` | rails, cloth, pockets, diamonds, backdrop `drawImage` | 31 |
| 293–347 | `drawBall` | ball shading, number, stripe | 3 |
| 349–393 | `drawCollisionPreview` (+`line` L378) | aim guide | 6 |
| 395–442 | `drawEdgeEffects` | rail/edge effects | 12 |
| 637–690 | `generateCuePattern` | cue overlay tiles | 3 |
| 1008–1267 | `render` (inside the table effect) | per-frame table/balls/cue | 8 |

`CueArtwork.tsx` (31 lines) renders cue designs as React/SVG markup from `src/lib/cue-design.ts` presets.

### racing / oval — `src/components/Racing.tsx` (canvas 2D)

| Lines | Function | Builds | Hits |
|---|---|---|---|
| 32–66 | `paintedVehicle` | recolour vehicle PNG by mask | 19 |
| 68–112 | `detailedVehicle` (+`seam` L77) | stripes/patterns on vehicle | 9 |
| 125–158 | `clipartRacecar` | procedural fallback car | 33 |
| 169–202 | `stockCarSprite` | stock-car livery sprite | 4 |
| 203–215 | `drawCar` | place car sprite | 2 |
| 216–224 | `drawPlaceBadge` | HUD badge | 4 |
| 241–254 | `roadRibbon` | road path | 2 |
| 272–311 | tile + `drawRoadTexture` | road surface | 5 |
| 312–366 | `drawRumbleStrips` | kerbs | 2 |
| 367–376 | `drawLapBanner` | start/finish banner | 4 |
| 383–398 | `widenPaintedRoad` | road mask | 3 |
| 409–423 | `drawForest` | trees | 7 |
| 424–450 | `drawOvalBackdrop`, `drawOvalMarkings` | oval scenery | 5 |
| 451–458 | `drawCourse` | course composite | 3 |
| 512–570 | `tick` (inside the race effect) | per-frame draw | 5 |
| 666–678 | garage preview effects | paint preview | – |

Track geometry constants (`CAR_SCALE`, `OVAL_BACKDROP`, `ROLLING_START`, `TRACK_MAP_SCALE`, `TRACK_SCENE_WIDTH/HEIGHT`, `trackFor`) are imported from `server/racing-engine.mjs` — rendering constants currently live in the physics file.

### park — `src/lib/park/` (raw WebGL2)

| File | Lines | Function | Builds | Hits |
|---|---|---|---|---|
| `gl.ts` | 98–210 | `class MeshBuilder` (`vertex` L102, `chain` L59 helper) | smooth-normal mesh builder (`quad`, `box`, `tri`, `cylinder`, `sphere`) | 14 |
| | 334–561 | `class Gl` | WebGL2 context, programs, shadow map, instancing, draw calls | 18 |
| `models.ts` | 15–119 | `treeModel` (+`mix3`, `foliage`) | organic trees/scenery | 40 |
| | 154–228 | `addPerson` | guest/staff body, 8 walk frames + idle, near/far detail | 20 |
| | 230–234 | `personModel` | wrapper | 3 |
| | 236–250 | `balloonModel`, `umbrellaModel` | props | 8 |
| | 252–304 | `stallModel` | stalls | 30 |
| | 306–325 | `gateModel`, `parkEntranceModel` | entrance | 13 |
| | 327–368 | `benchModel`, `binModel`, `lampPostModel`, `lampHeadModel`, `litterModel` | street furniture | 27 |
| | 376–579 | `flatRideModel` (+`floor` L378) | every flat ride | 94 |
| | 581–594 | `carModel` | coaster car | 10 |
| `renderer.ts` | 106–234 | `ParkRenderer.rebuildStatic` | terrain, water, paths, scenery instances | – |
| | 235–250 | `rebuildLitter` | litter instances | – |
| | 251–261 | `rideModel` | ride model cache | – |
| | 268–347 | `coasterCache`, `trackGeometry` | coaster rails/ties/supports | – |
| | 348–358 | `carMesh` | car + riders | – |
| | 359–378 | `lighting` | sun/moon lighting | – |
| | 458–645 | `drawWorld`, `drawFlat`, `drawCoaster`, `drawPeople`, `drawRain`, `drawPreview` | frame passes | – |

Colour and size constants are top-level in `renderer.ts` L8–28 (`TILE`, `SURFACE_COLORS`, `WATER_*`, `PATH_*`, `FLAT_TINTS`, …) and in `models.ts` (`C`, `SHIRTS`, `GUEST_LOOKS`, `STAFF_LOOK`, `WALK_FRAMES`).

## 3. Method

- Sizes: `stat`/`wc -l` on `main@a90bd92`.
- CDN loads: every `https://` URL in each entry file.
- Contracts: grep for `tl-score-saved`, `tl-lap`, `tl-host`, `tl-room`, `tlScores.submit`, `/api/*`, `get('room'|'track'|'name')`, `new Peer(`.
- Builders: a brace-matching scanner over each file that counts `new THREE.`, `BufferGeometry`, `Mesh(`, `drawImage(`, `fillRect(` and canvas path calls per enclosing function; results were then checked by hand against the source. Functions with fewer than two hits are omitted unless they are the public factory.
