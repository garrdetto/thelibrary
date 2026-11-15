## Next steps: from today to the first sale

The goal for the first 30 days is one real product making its first sale, or a clean decision to kill it, while model spend stays under a cap you set. The engine has to work before it can earn, so the order matters.

**Today (about an hour)**

- [ ] Create a Claude Console account, make an API key, and set a monthly spend limit there (start at $50 to $100).
- [ ] Install Claude Code, clone `garrdetto/thelibrary`, and open the `empire/` folder.
- [ ] Set two environment variables: `ANTHROPIC_API_KEY` and `EMPIRE_SEAL_SECRET` (any long random string).
- [ ] Open a dedicated email for the business and decide its name. You will create every account yourself; the agents never do.
- [ ] Choose a storefront that acts as merchant of record, such as Lemon Squeezy or Paddle, so sales tax is collected and remitted for you. Open the account; do not connect it to anything yet.

**Week 1: build the engine (Phases 0 to 2)**

- [ ] Paste the Phase 0 prompt from `empire/BUILD_PROMPTS.md` into Claude Code. Check its gate before moving on.
- [ ] Phase 1: run `empire run-demo` and confirm a full King → Warlord → Servant → review loop costs under $1.
- [ ] Phase 2: let the Oracle Spire run its nightly sweep for 3 to 5 nights.
- [ ] Read the Opportunity Briefs yourself. Throw out anything without real evidence of buyers.

**Week 2: pick one venture and add the safety net (Phase 3)**

- [ ] Choose one brief that passes all four tests: a digital product, priced $9 to $39, buyers you can reach in a known place, buildable in a week.
- [ ] Approve its Venture Charter with your Seal, including kill criteria and a kill date.
- [ ] Phase 3: turn on the full Inquisition, the Ladder of Merit and the Archive. Do not skip this; it is what keeps quality up once you stop watching every task.

**Week 3: build and launch (Phases 4 to 6)**

- [ ] Phase 4: connect the Command Center to the live engine and set up phone notifications for Seal requests.
- [ ] Phase 5: let the Forge and Foundry build the product on staging. Buy the product yourself on staging and try to break it.
- [ ] Phase 6: approve the listing, then post it yourself in 3 to 5 places where buyers already gather, written as a genuine member, not as an ad blast.
- [ ] Add an email capture so every visitor who does not buy can still be reached later.

**Week 4 and on: run it**

- [ ] Daily (10 minutes): clear the Seal Queue, read the Treasury report, check any Inquisition flags.
- [ ] Weekly (30 minutes): hold the Court of Merit, review the venture against its kill criteria, and look at cost per verified task.
- [ ] At the kill date: if there are no sales, kill it, keep the lessons, and charter the next-best brief. If it sells, add a second product for the same buyers before starting a new niche.

**Keeping it smooth**

- Host the Throne Engine on one small always-on server. Your repo's multiplayer server already runs on Railway; the engine can live there the same way.
- Keep two spending limits: the Console limit as a hard backstop, and the Codex daily ceiling in `codex.yaml` as the working limit.
- Back up the ledger database daily. It holds every task, cost, verdict and merit point.
- Treat a spike in returned work or Oathbreaking as a signal to tighten a charter, not to raise the budget.

**What to expect**

Plan on roughly $200 to $500 a month in model costs during the build and first launch, plus about $20 to $50 in tools. The first sale is a realistic goal for weeks 3 to 6; covering the empire's own running costs is the next milestone. Most first ventures do not succeed, so the system is built to make each attempt cheap and to carry the lessons into the next one.
