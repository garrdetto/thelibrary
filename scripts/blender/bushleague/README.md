# Bush League Baseball: Blender clean-up

Turns a Meshy export into game-ready glTF on the shared ballplayer skeleton. Runs headless on the admin's machine (tested with Blender 5.2):

```bash
blender -b --factory-startup -P scripts/blender/bushleague/cleanup.py -- --input ~/Downloads/bushleague-rig-1a2b3c.glb --name player-lean --kind player
```

- `--kind player` scales to 1.85 m, renames a Meshy or Mixamo armature to the bone names in `modules-src/bushleague/players/Rig.ts`, writes the `_slot` uniform attribute and exports LODs at 25k / 8k / 2k triangles.
- `--kind prop` keeps the model's size and exports 15k / 5k / 1.5k.
- `--out` defaults to `assets-src/models/bushleague/`; `--no-ao` skips the Cycles AO bake.

Then run `pnpm assets` and commit `assets-src/models/bushleague/` and `public/models/bushleague/` together.

The `_slot` attribute is a height-band first pass (cap, skin, trim, jersey, belt, pants, socks, cleats; arms past the elbow are skin). Check it in Blender's spreadsheet or with a quick vertex-paint view and fix anything the bands got wrong (sleeves on long-sleeved players, beards) before exporting for good.

Order of work in the admin panel's **Bush League** tab: generate previews from `assets-src/models/bushleague/prompts.json`, refine the best, rig players at 1.85 m, add animation clips, download the .glb, run this script.
