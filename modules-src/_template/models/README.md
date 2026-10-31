# models

One file per 3D model, each exporting a single factory (`createCrate(spec)`, `createGround(spec)`). A factory takes a typed spec whose values come from `../config.ts`, builds geometry and materials with `three/webgpu`, and returns an `Object3D`. Models never import game rules (`../systems/`), never read globals, and never contain magic numbers: sizes, colors and material settings arrive in the spec. Loaded assets (GLB, KTX2) go through `engine/core/Assets.ts` and are wrapped by a factory here, so callers never touch loaders.
