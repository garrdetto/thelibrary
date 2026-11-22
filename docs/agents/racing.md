# Racing and pool

Max Secure Circuit, Oval Speedway and the pool table. Moved out of AGENTS.md so it loads only when this area is worked on; keep it current here, not in AGENTS.md.

- `src/components/PoolTable.tsx`, `PoolLobby.tsx`, `CueArtwork.tsx`, `src/lib/pool-*.ts`, `src/lib/cue-design.ts`: pool.
- `src/components/Racing.tsx`, `src/lib/racing.ts`, `server/racing-engine.mjs`: racing. Max Secure Circuit (`#racing`) and Oval Speedway (`#oval`) are separate modules; each mounts `Racing` with `fixedTrack`. Their page styling uses the `--lib-*` site tokens (scoped under `.racing-content`) and the module accent from `modules.ts`.
- `server/racing-engine.mjs` is shared by browser and server. Any change to it, or to server lobby/race code, requires redeploying the multiplayer service; bump the `/version` string in `server/index.mjs` and note it in `server/README.md`.
- Keep single-player and multiplayer physics identical by changing the shared engine rather than duplicating logic in `Racing.tsx`.
