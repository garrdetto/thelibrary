# King Farquad's Empire: Claude Code starter kit

Everything Claude Code needs to build the empire described in `docs/EMPIRE_PLAN.md`.

## What's here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Build rules Claude Code reads automatically |
| `NEXT_STEPS.md` | What to do today, week by week, to reach a first sale |
| `BUILD_PROMPTS.md` | Eight phase prompts, each with a gate to check |
| `docs/EMPIRE_PLAN.md` | The full plan (exported from your doc) |
| `codex.yaml` | Chain of command, model ceilings, routing, budgets, Seal list, refusals |
| `agents/*.yaml` | 39 agent dossiers: King Farquad, 8 Warlords, 30 Servants |
| `charters/*.md` | One charter per department |
| `archive/` | Lessons (one file per agent), skills and eval sets, empty to start |
| `prototype/command-center.html` | The Command Center console (personnel roster, fortress view, Intel and Command tabs, themes); open it in a browser. Phase 4 connects it to the live engine |
| `engine/` | Empty; Claude Code builds the Throne Engine here |
| `wrangler.jsonc`, `worker.js` | Hosting for the console on the `kingdom` Cloudflare Worker |

## Start

Read `NEXT_STEPS.md` first. Then:


1. Install Claude Code and Python 3.12. Get a Claude API key from the Claude Console and set `ANTHROPIC_API_KEY`.
2. Open the `empire/` folder of `garrdetto/thelibrary` in Claude Code (`cd empire && claude`).
3. Paste the Phase 0 prompt from `BUILD_PROMPTS.md`. Check its gate. Continue phase by phase.
4. Set `EMPIRE_SEAL_SECRET` before Phase 4 so Seal approvals can be signed.

## Hosting

The console is live at https://kingdom.garrdetto.workers.dev. The `kingdom` Worker builds from this folder only (Workers Builds root `/empire`, watch path `empire/*`), so a merge to `main` that changes `empire/` redeploys it and other changes in the repository don't. `worker.js` serves `prototype/command-center.html` at `/`. Off claude.ai the simulation runs but per-agent live chat stays off until Phase 4 connects the console to the Throne Engine.

Nothing spends money or touches the public before Phase 5, and even then every such action waits for your Seal.
