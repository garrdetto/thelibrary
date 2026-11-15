# Build prompts

Paste one prompt per phase into Claude Code from this folder. Check the gate before moving on.

Build in eight phases, each ending at a gate you check before moving on. Nothing that spends money or touches the public exists until Phase 5. This kit already holds the plan at `docs/EMPIRE_PLAN.md`, `CLAUDE.md`, `codex.yaml`, 39 agent dossiers and 8 charters.

**Phase 0: Foundation and the Codex.** Gate: tests prove every Seal-list action is refused without your approval.

```
Read CLAUDE.md and docs/EMPIRE_PLAN.md. Scaffold the repository layout from the plan's Architecture section. codex.yaml, agents/*.yaml and charters/*.md already exist: write schemas for them and validate all three at startup. Write engine/codex.py exposing check(action, agent, task) -> allow | deny | needs_seal, and tests covering every Seal-list action. Do not call any model yet.
```

**Phase 1: Throne Engine core.** Gate: a demo runs King, Warlord, Servant, review and back, with costs logged under $1.

```
Build the Throne Engine. SQLite ledger with tables tasks, routing_records, reviews, costs, events, merit. Load agents/*.yaml. routing.py implements S = C + N + 3K and the tier table from the plan. runner.py runs one task as a Claude Agent SDK query() whose system prompt is the department charter + agent dossier + top 5 relevant lessons, with only that agent's tools, and the model and effort from its routing record (claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5). Add empire MCP tools delegate_task, submit_work, request_review, write_lesson. A parent task parks while its children run and resumes with their results once they are verified. Log tokens and cost per call from the usage data. Add `empire run-demo`: King Farquad delegates a small research question to the Oracle Spire and gets a reviewed answer back.
```

**Phase 2: Recon and War Room, read-only.** Gate: 10 Opportunity Briefs with at least 90% of sampled citations verified, and one Venture Charter waiting for your Seal.

```
Activate the Oracle Spire (Nyx Farsight, Wren, Kestrel, Moth, Sift), the War Room (Castellan Vane, Rook, Gambit, Sage) and a minimal Inquisition (Orrin Vale, Verity). Recon gets web search and fetch only; wrap all fetched content as untrusted data. Define Opportunity Brief and Venture Charter as JSON Schema plus markdown templates, and make submit_work validate against them. Verity checks a random 30% of citations. Schedule a nightly sweep that files 5 briefs and ranks them; the King charters at most 2. No spending, publishing or account tools exist in this phase.
```

**Phase 3: Inquisition, Merit and Archive.** Gate: a test shows an eval regression rolling back automatically, and Court of Merit promotions recorded in the ledger.

```
Implement the full review pipeline: automated checks first, then a reviewer at the maker's tier or higher, a different model when stakes K >= 4, and random audits of 10% of passed work (30% for agents promoted in the last 2 weeks). Implement merit.py with the merit table, blind Elo Trials, the weekly Court of Merit (promotion, demotion, retirement as registry changes; never edits codex.yaml) and Oathbreaking detection when submit_work claims contradict check results. Build the Archive: a lesson after every task, full-text search before every task, weekly clustering of lessons into skills from verified work only, and an eval runner per department that rolls back any change that lowers the score.
```

**Phase 4: Command Center.** Gate: you approve a Seal from your phone and watch the task continue on the map.

```
Build ui/ from prototype/command-center.html using React, Vite and PixiJS. Keep its look, panels and interactions. Replace the simulator with the API's WebSocket event stream (event names in the plan), and keep simulation mode behind a visible toggle with a banner. Add FastAPI endpoints for agents, tasks, chat (each chat message runs through the Codex as a task), decrees, Seal approve and deny (signed with a local secret), merit and treasury. Add a day replay scrubber and Seal notifications through a Telegram or Discord bot.
```

**Phase 5: Forge, Foundry, Treasury and the first product.** Gate: one product passes the Inquisition and waits for its launch Seal, and the books reconcile.

```
Activate the Forge, the Foundry and the Treasury. Builds run in a Docker sandbox per task and deploy to staging only. Cipher connects a secrets vault and issues scoped, expiring tokens; no agent ever sees a raw password. Tally reconciles payment payouts and API spend into the ledger daily; Abacus builds the Treasury dashboard. Take the sealed Venture Charter from Phase 2 through Build Spec, Release Candidate and Product Dossier to an Inquisition verdict, then stop at the launch Seal.
```

**Phase 6: Heralds and launch.** Gate: a first real sale, or a clean kill decision with lessons archived.

```
Activate the Heralds. From the charter, build the Launch Plan: listing copy, useful search pages, opt-in email capture, and community posts drafted for the Seal. Enforce the refusal list (no fake reviews, no bot accounts, disclosures always shown). Solace answers support within the refund cap. The Treasury and War Room run a weekly scale, fix or kill review against the charter's kill criteria.
```

**Phase 7: Scale.** Gate: cost per verified task falls month over month, and at least one venture covers the empire's running costs.

```
Add the portfolio board, cost-per-merit reports, Batch API routing for work nobody is waiting on, and step-down tests in routing. Add an option to run agent sessions on Claude Managed Agents. Allow up to 3 concurrent ventures under the Codex caps.
```
