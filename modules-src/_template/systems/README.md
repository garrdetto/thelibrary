# systems

Rules and simulation for this learning module: scoring, turns, AI, economy, win conditions. Systems are plain TypeScript working on plain data. They never import three.js, the engine renderer or anything in `../models/`, so they can run in a worker, on a server or in tests. Each system is one file exporting one thing; tunables come from `../config.ts`. `../index.ts` reads system state each fixed step and moves meshes to match.
