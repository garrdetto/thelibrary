# Meshy models from Site changes

Ask for a 3D object in **Admin → Site changes** ("add a rowboat at the Northwoods Angler dock", "give Fox Plains a park ranger who waves") and Claude generates it with Meshy, cleans it up, optimises it and wires it into the module in the same pull request.

```
Site changes prompt ──► site-change.yml (GitHub, or your laptop with "Run on my laptop")
                          └─ Claude Code
                               ├─ node scripts/meshy-generate.mjs …   Meshy: preview → refine → rig → animate
                               │     └─ blender -b -P scripts/blender/meshy-cleanup.py   (when Blender is installed)
                               ├─ pnpm assets                            assets-src/models → public/models (meshopt, WebP)
                               └─ module code that loads the model       → pull request → modules check → live
```

## One-time setup

1. **Meshy key for GitHub (optional).** GitHub → garrdetto/thelibrary → Settings → Secrets and variables → Actions → New repository secret: `MESHY_API_KEY`, the same key as the Cloudflare secret the Meshy panel uses. Rigging and animation need a paid Meshy plan. Without it, site changes still make models through the site's own Meshy connection (`node .github/site-changes/meshy.mjs`, which uses the Cloudflare key and a pass that only works during the run) and Claude runs `scripts/blender/meshy-cleanup.py` on the download itself; `scripts/meshy-generate.mjs` below needs the GitHub secret.
2. **Credit cap (optional).** Repository variable `MESHY_MAX_CREDITS` (default 150). A run whose estimate is higher stops before spending anything.
3. **Blender on the laptop.** In Ubuntu (WSL): `cd ~/thelibrary && git pull && bash scripts/laptop-runner/install-blender.sh`. New laptops get it from `setup.sh`. GitHub's machines have no Blender, so tick **Run on my laptop** for 3D requests; on GitHub the model is still made, just without the clean-up step (Claude sizes and places it in code instead).

## What the generator does

`node scripts/meshy-generate.mjs --help` lists every option.

| Step | Meshy credits (estimate) | Notes |
| --- | ---: | --- |
| Preview (mesh) | 20 (5 with `--ai-model meshy-6-lite`) | Remeshed to the target's triangle budget, origin at the bottom |
| Refine (PBR textures) | 10 | `--texture-prompt` adds texturing direction |
| Rig | 5 | Humanoid, two-legged characters only (`--target character` or `ballplayer`), facing +Z |
| Animate | 3 per clip | Up to 10 library clips in one file: `--animate idle,walk,wave` or action ids; `--list-animations` shows them |
| Blender clean-up | 0 | Ground, centre, `--height` / `--size`, smooth shading (welds Meshy's triangle soup, Shade Smooth, creases over `--smooth-angle` 40° kept sharp, Weighted Normals; `--no-smooth` skips it), `--wheels <n>` for vehicles (each wheel a `wheel-<k>` part with its origin at its centre), `--max-tris`, `--lods`; Bush League folders use `scripts/blender/bushleague/cleanup.py` |

- Output: `assets-src/models/<module>/…/<name>.glb` (or `<name>-lod0.glb` …) plus `<name>.meshy.json`, the record of the prompt, settings, Meshy task ids and credits. Raw downloads stay in `.meshy-cache/` (git-ignored).
- Clips are renamed to their short names (`idle`, `walk`, `wave`), so modules play them by name.
- Running the same command again resumes from the saved task ids instead of paying twice. Changing the prompt or settings under the same `--name` is refused unless you pass `--fresh`; adding clips later (a different `--animate` list) only pays for the new animation task.
- Everything that isn't a humanoid (vehicles, rides, animals, spinning or bobbing props) is animated in the module's own code.

## Trying it without spending credits

```bash
node scripts/meshy-mock.mjs &
MESHY_API_KEY=msy_dummy_api_key_for_test_mode_12345678 MESHY_API_BASE=http://localhost:8790/openapi \
  node scripts/meshy-generate.mjs --prompt "a park ranger, full body, A-pose" --name ranger --out assets-src/models/maplestreet/characters \
  --target character --height 1.8 --animate idle,walk,wave
```

The mock returns a small car for text-to-3D and a two-bone figure for rigging and animation.
