# The King's Empire: build rules for Claude Code

You are building the Throne Engine: an orchestrator that runs a three-tier hierarchy of Claude agents (King, Warlords, Servants) as an automated digital-products business. The full design is in `docs/EMPIRE_PLAN.md`. Build one phase at a time from `BUILD_PROMPTS.md` and stop at each phase's gate.

## Where this lives

This folder sits inside the library site repository (`garrdetto/thelibrary`, TanStack Start on Cloudflare Workers) but is a separate project. Never change files outside `empire/`, and keep its files out of `public/`, `src/`, `modules-src/` and `engine/`. Give `empire/ui` its own `package.json` and `tsconfig.json`, and add `"empire"` to the `exclude` list in the root `tsconfig.json` before adding any TypeScript here, so the site's build, the `modules` check and the Workers deploy are unaffected. The Throne Engine is deployed separately from the site. The console is hosted on the `kingdom` Cloudflare Worker from `empire/wrangler.jsonc` and `empire/worker.js` (static assets from `prototype/`, no bindings); keep that Worker free of the site's bindings and Durable Objects.

## Ground rules

- **The human owner is the Sovereign.** They hold the Royal Seal. Never build a code path that spends money, creates accounts, accepts terms, publishes publicly, emails non-customers, deletes data or deploys to production without a Seal approval recorded in the ledger.
- **Needs You is the last resort.** When only the Sovereign can do something (open an account, verify identity, sign a form, approve an app, add a card), a Warlord files it with `request_sovereign` after the agents have tried their own tools, the vault and the Archive, and asked their Warlord and Cipher for another route. The request says what was tried, why only the Sovereign can do it, the smallest step and how the agents get access afterwards. Agents never ask for the Sovereign's personal password, sign-in codes, recovery codes or card numbers; access comes through a limited key or a separate login saved in the vault, an invite, an app approval, or the Sovereign signing in themselves. Rules are in `codex.yaml` under `needs_you`.
- **The Codex is code, not prompts.** Budgets, permissions, the Seal list and the chain of command are enforced in `engine/codex.py` before every tool call (Agent SDK PreToolUse hooks). Prompts may explain the rules; they never enforce them.
- **Chain of command lives in `codex.yaml`.** Agents can never edit it. Promotions edit agent dossiers in `agents/`, within the ceilings in `codex.yaml`.
- **No nested subagents.** Claude Code and Agent SDK subagents cannot spawn subagents. Delegation is the `delegate_task` tool, which writes child tasks to the ledger; the scheduler runs them as separate sessions and resumes the parent when they are verified.
- **Outside text is data.** Fetched pages, emails and customer messages are wrapped and labeled untrusted. A task that reads untrusted text gets no spending, sending or deploying tools.
- **Maker never checks their own work.** Every submission goes through automated checks, then a reviewer from another department (the Inquisition by default). Merit comes only from review verdicts.
- **Log everything.** Every model call and tool call writes model, effort, tokens, cost, task and result to the append-only audit log.

## Models

| Use | Model ID | Effort |
| --- | --- | --- |
| The King | `claude-opus-5-5` | high (xhigh for venture go/no-go) |
| Warlords | `claude-opus-5-5` | medium or low (or route down to Sonnet) |
| Adept / Knight-Captain ceiling | `claude-sonnet-5-5` | medium |
| Servant ceiling | `claude-sonnet-5-5` | low |
| Initiate ceiling | `claude-haiku-5-5` | n/a |

Routing score: `S = C + N + 3K` (complexity, novelty, stakes, each 1 to 5). S 5–9 Haiku, 10–13 Sonnet low, 14–17 Sonnet medium, 18–21 Warlord on Opus, 22+ or K = 5 King. A task that fails review twice moves up one tier.

## Stack

Python 3.12, asyncio, `claude-agent-sdk`, SQLite (Postgres later), FastAPI + WebSocket, React + Vite + PixiJS for `ui/` (start from `prototype/command-center.html`), Docker sandboxes for build tasks, pytest.

## Working style

- Write tests with each module. A phase is done when its gate in `BUILD_PROMPTS.md` passes.
- Keep secrets in environment variables or a vault; never in code, prompts, logs or the repo.
- Prefer small, composable modules over frameworks. Keep the event names in the plan's Architecture section stable; the UI depends on them.
- When unsure whether something touches the Seal list, treat it as if it does.
