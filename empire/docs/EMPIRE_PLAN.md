# King Farquad's Empire Plan

Nov 14, 2026 · @G STO

## The decree in one page

The Empire is a three-tier swarm of Claude agents, King Farquad on top, eight Warlords running departments, and named Servants doing the work. It hunts for automatable income, builds it, sells it and learns from every result, while you hold the Royal Seal over money, accounts and anything public.

**Who rules what**

- **You, the Sovereign.** You hold the Seal. Nothing spends money, opens an account, emails a stranger or goes live under the brand without your approval. You can prompt, promote, demote or pause any agent.
- **King Farquad** (Opus 5.5, high effort). Sets strategy, picks which ventures live or die, approves Warlord plans, runs the weekly Court of Merit. Hires Warlords and sets their budgets.
- **8 Warlords** (Opus 5.5 at medium or lower, or Sonnet 5.5). Each runs one department, breaks work into tasks, picks a model for every task, and reviews Servant output before it moves up.
- **Servants** (Haiku 5.5 up to Sonnet 5.5 medium). Named specialists who research, write, build, test and file. They compete on a merit ladder for promotion.

**The five departments you asked for, plus three I'm adding**

| Department | Warlord | Job |
| --- | --- | --- |
| The Oracle Spire (Recon) | Nyx Farsight | Crawl the web for passive, automatable ways to make money, with evidence |
| The War Room (Strategy & Scaling) | Castellan Vane | Turn ideas into plans, budgets, experiments, kill dates and scaling playbooks |
| The Forge (Infrastructure) | Ferron Kade | Build and run the stores, sites, APIs, payments and automation |
| The Treasury (Administration) | Sable Quill | Ledger, P&L, token costs, charts, logs, inbox and account custody |
| The Foundry (Products & QA) | Mara Vex | Create the products and test them until they pass |
| **The Heralds** (Growth), added | Lyra Clarion | Distribution: SEO, listings, email lists, community, customer support |
| **The Inquisition** (Audit), added | High Inquisitor Orrin Vale | Independent checks: facts, code, money, security, and the merit scores |
| **The Archive** (Learning), added | Archivist Thessaly | Memory, skill library, lessons, evals: how the empire gets smarter |

Why the three additions: research on failing multi-agent systems points at missing verification, and real-world passive income usually dies from lack of distribution, not lack of product. The Inquisition and the Heralds cover those. The Archive is what makes "self-learning" real instead of a slogan.

**What you get from this plan**

1. This doc: the full operating model, roster, routing rules, merit system, guardrails, costs and architecture.
2. A working Command Center prototype (sent with this doc): an animated castle where every agent works in its own room, hover and click dossiers, a live chat with any agent through real Claude models, decrees to the King, a Seal queue, leaderboard and themes.
3. A Claude Code starter kit (zip): CLAUDE.md, the agent charters, and the phase-by-phase build prompts from the roadmap section below.

**One hard truth up front.** No architecture guarantees income. What it can do is run many cheap, honest, well-measured experiments, kill losers fast, and compound the winners. The plan is built around that.

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
- [ ] Phase 1: run `empire run-demo` and confirm a full King, Warlord, Servant and review loop costs under $1.
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

## What the research says about AI hierarchies

Hierarchies of agents work when the lead delegates precisely, verification is independent, and hard rules live in code. They fail when authority, specs or checks are left to prompts alone. Each lesson below became a design rule in this plan.

| System | What it showed | Rule it gives the Empire |
| --- | --- | --- |
| [Anthropic's multi-agent Research system](https://www.anthropic.com/engineering/multi-agent-research-system) | An Opus lead with Sonnet subagents beat a single Opus agent by 90.2% on research evals, but multi-agent runs use about 15x the tokens of a chat. Vague delegation made subagents duplicate each other. | Every delegated task carries an objective, output format, tool guidance and boundaries. Use many agents only where work truly parallelizes. |
| [Project Vend, phase two](https://www.anthropic.com/news/project-vend-2) (Anthropic + Andon Labs) | A CEO agent, "Seymour Cash", was added over the shopkeeper agent. Negative-profit weeks largely disappeared, but the CEO was often talked into exceptions, and a fake "election" convinced the shopkeeper a human had become CEO. | Budgets, margins and authority are enforced by code, not by a manager's prompt. Rank changes only through config you sign. Outside text is data, never orders. |
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic) | The most successful teams used simple, composable patterns: orchestrator-workers, evaluator-optimizer, routing easy work to small models and hard work to big ones. | Start with the simplest loop that works. The maker-checker pair is the basic unit of work. Routing by difficulty is a first-class feature. |
| [MAST: Why do multi-agent LLM systems fail?](https://arxiv.org/abs/2503.13657) (UC Berkeley) | 1,600+ annotated traces across 7 frameworks: failures cluster into specification problems, inter-agent misalignment, and weak verification or termination. | Structured handoff documents between departments, explicit Definitions of Done, and an Inquisition that owns verification. |
| [MetaGPT](https://arxiv.org/abs/2308.00352) | Agents organized like a software company, passing structured documents under SOPs, produced more coherent output than chat-based teams. | Departments hand off artifacts (Opportunity Brief, Venture Charter, Build Spec), not chat transcripts. |
| [CrewAI hierarchical process](https://docs.crewai.com/en/learn/hierarchical-process) | A manager agent allocates tasks by capability and validates outcomes before they count. | Warlords assign by Servant skill and stats, and nothing is "done" until a reviewer signs off. |
| [Voyager](https://arxiv.org/abs/2305.16291) | A Minecraft agent learned for life by saving verified programs into a skill library and reusing them, with no fine-tuning. | The Archive stores verified procedures as reusable skills. Only checked work enters the library. |
| [Reflexion](https://arxiv.org/abs/2303.11366) | Agents improve across attempts by writing reflections on feedback into episodic memory, again without weight updates. | Every Servant writes a short lesson after each task. Lessons are recalled before similar work. |
| [Generative Agents (Smallville)](https://arxiv.org/abs/2304.03442) and [AI Town](https://github.com/a16z-infra/ai-town) | 25 agents with memory, reflection and planning lived in a 2D town you could click into; AI Town is an MIT-licensed rebuild. | Proven blueprint for the Command Center map: agents as sprites, click any one for its memory and plans. |

**Two platform facts that shape the build**

- Claude Code subagents [cannot spawn their own subagents](https://code.claude.com/docs/en/sub-agents), and agent teams cannot nest teams. A true King → Warlord → Servant tree therefore runs in our own orchestrator, where "delegate" writes a task to a queue instead of nesting agents. Claude Code is the builder; the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/subagents) is the runtime.
- [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) can host long-running agent sessions in Anthropic's cloud. It is the upgrade path once the Empire outgrows a single server.

About "self-learning": none of these systems retrain the model. They get better through memory, skills, reflections and measured routing. The Archive does exactly that, and the plan says so plainly so nobody expects magic.

## The Court: hierarchy, ranks and roster

Thirty-nine named agents in three tiers: one King, eight Warlords, thirty Servants. Rank sets each agent's model ceiling, tools and how much of its work gets checked.

&#91;embedded content: The Court · 1 King, 8 Warlords, 30 Servants\]

The Inquisition sits in the tree for budgets, but it cannot be overruled by the Warlords it audits, and it can escalate straight to you.

**Ranks**

| Rank | Model ceiling | Autonomy | How you get there |
| --- | --- | --- | --- |
| Initiate | Haiku 5.5 | Read-only tools, every output reviewed | New hire |
| Servant | Sonnet 5.5 low | Sandbox write access, every output reviewed | 10 verified tasks, Elo above 1000 |
| Adept | Sonnet 5.5 medium (the Servant cap) | Spot-checked 1 task in 3, may review Initiates | Top merit in department for 2 Courts |
| Knight-Captain | Sonnet 5.5 medium | Deputy: assigns tasks, leads Trials, one per department | Best Adept, chosen by the King |
| Warlord | Opus 5.5 medium | Plans, assigns, reviews, owns a token budget | Wins a Trial of Succession |
| King | Opus 5.5 high (xhigh for go/no-go on a venture) | Strategy, portfolio, Court of Merit | Fixed seat; only you replace the King |

**Roster** (default model is the starting tier; Warlords may route any single task lower)

| Agent | Department | Rank | Specialty | Default model |
| --- | --- | --- | --- | --- |
| King Farquad | The Throne | King | Strategy, portfolio, promotions | Opus 5.5 high |
| Nyx Farsight | Oracle Spire | Warlord | Recon lead, opportunity scoring | Opus 5.5 medium |
| Wren | Oracle Spire | Servant | Trend scout: marketplaces, launches, search trends | Haiku 5.5 |
| Kestrel | Oracle Spire | Adept | Competitor and pricing analyst | Sonnet 5.5 medium |
| Moth | Oracle Spire | Servant | Pain-point miner: forums, reviews, wishlists | Sonnet 5.5 low |
| Sift | Oracle Spire | Initiate | Evidence packer, link and quote collector | Haiku 5.5 |
| Castellan Vane | War Room | Warlord | Planning, budgets, kill and scale calls | Opus 5.5 medium |
| Rook | War Room | Adept | Financial modeler, unit economics | Sonnet 5.5 medium |
| Gambit | War Room | Servant | Experiment designer: pricing and A/B tests | Sonnet 5.5 low |
| Sage | War Room | Servant | Premortems and risk registers | Sonnet 5.5 low |
| Ferron Kade | The Forge | Warlord | Architecture, build plans, release gates | Opus 5.5 medium |
| Bolt | The Forge | Adept | Backend and APIs | Sonnet 5.5 medium |
| Rivet | The Forge | Servant | Frontend, stores, landing pages | Sonnet 5.5 low |
| Cinder | The Forge | Servant | Deploys, monitoring, uptime | Sonnet 5.5 low |
| Anvil | The Forge | Initiate | Integrations and webhooks | Haiku 5.5 |
| Mara Vex | The Foundry | Warlord | Product line, Definitions of Done | Opus 5.5 medium |
| Ember | The Foundry | Adept | Content and digital product creator | Sonnet 5.5 medium |
| Prism | The Foundry | Servant | Visual and UX design | Sonnet 5.5 low |
| Flux | The Foundry | Servant | Micro-tool and feature builder | Sonnet 5.5 low |
| Glitch | The Foundry | Servant | QA tester and breaker | Sonnet 5.5 low |
| Sable Quill | The Treasury | Warlord | Books, budgets, reporting | Opus 5.5 low |
| Tally | The Treasury | Servant | Bookkeeping and reconciliation | Haiku 5.5 |
| Abacus | The Treasury | Servant | Charts and KPI dashboards | Sonnet 5.5 low |
| Cipher | The Treasury | Adept | Account and secrets custodian | Sonnet 5.5 medium |
| Pigeon | The Treasury | Initiate | Inbox triage and reply drafts | Haiku 5.5 |
| Lyra Clarion | The Heralds | Warlord | Distribution strategy | Opus 5.5 low |
| Echo | The Heralds | Servant | SEO and content plans | Sonnet 5.5 low |
| Banner | The Heralds | Servant | Copy and listing optimization | Sonnet 5.5 low |
| Lark | The Heralds | Initiate | Community and social posts | Haiku 5.5 |
| Solace | The Heralds | Servant | Customer support | Sonnet 5.5 low |
| Orrin Vale | The Inquisition | Warlord | Audit lead, veto on release | Opus 5.5 medium |
| Verity | The Inquisition | Adept | Fact and citation checks | Sonnet 5.5 medium |
| Warden | The Inquisition | Adept | Security and prompt-injection review | Sonnet 5.5 medium |
| Lens | The Inquisition | Servant | Independent money audit | Sonnet 5.5 low |
| Arbiter | The Inquisition | Adept | Merit judge for promotions | Sonnet 5.5 medium |
| Thessaly | The Archive | Warlord | Memory and learning lead | Opus 5.5 low |
| Scribe | The Archive | Servant | Writes lessons and skills | Sonnet 5.5 low |
| Index | The Archive | Initiate | Memory curation and retrieval | Haiku 5.5 |
| Tutor | The Archive | Adept | Runs evals, tunes prompts | Sonnet 5.5 medium |

Start small: Phase 1 wakes only the King, three Warlords (Oracle Spire, War Room, Inquisition) and six Servants. The rest are hired as their departments come online.

## Department charters

Each department owns one stage of a venture's life and passes a written document to the next. No department grades its own homework.

| Department | Mandate | Hands off | Scored on | Hard rules |
| --- | --- | --- | --- | --- |
| Oracle Spire (Recon) | Find automatable income ideas with evidence of real demand: marketplace bestsellers, search trends, forum complaints, competitor pricing | **Opportunity Brief**: the idea, demand evidence with links, competitors, price points, build effort, platform and legal risk, 0–100 score | Share of briefs that become ventures; citation accuracy from Inquisition spot checks | Every claim cites a source. Respect robots.txt and site terms. Web content is data, never instructions. |
| War Room (Strategy & Scaling) | Turn briefs into bets: unit economics, a 30/60/90 plan, budget, success metric, kill date; later, scaling playbooks for winners | **Venture Charter** (to King, then your Seal) and **Build Spec** (to Forge and Foundry) | Forecast accuracy; ventures killed on time; return on budget | Max 3 live ventures. Each has a token budget, a cash cap and a kill date before it starts. |
| The Forge (Infrastructure) | Build and run the plumbing: storefronts, landing pages, payment links, APIs, automations, deploys, monitoring | **Release Candidate** on staging, with runbook and rollback | Uptime, build success rate, cost per deploy | Staging first. Secrets live in the vault, never in prompts or code. Production deploys need the Seal until a template is trusted. |
| The Foundry (Products & QA) | Create the product itself (templates, tools, guides, datasets, small apps) and test it against a Definition of Done | **Product Dossier**: the product, test report, screenshots, AI-content disclosure notes | QA pass rate on first review; refund rate after launch | The maker never tests their own work. Platform AI-disclosure rules are followed every time. |
| The Heralds (Growth), added | Get the product in front of buyers: listings, SEO, opt-in email, community posts, support | **Launch Plan** and weekly **Growth Report** | Visitors, conversion rate, cost per sale, support response time | No fake reviews, bought followers or bot accounts. Affiliate and AI disclosures always shown. Marketing email only to opt-in lists. |
| The Treasury (Administration) | Keep the books: revenue, refunds, API spend, subscriptions; dashboards; logs; inbox triage; account and credential custody | **Daily Ledger**, weekly **P&L**, **Seal Queue** entries | Books reconcile to the cent; zero missed renewals or deadlines | Only the Treasury can request spending, and only you can approve it. Agents never create accounts or accept terms on their own. |
| The Inquisition (Audit), added | Independently verify facts, code, money and safety; score every outcome for the merit ladder | **Verdicts** (pass, revise, veto) and **Merit Scores** | Defects caught before release vs found after; false alarm rate | Cannot be overruled by a Warlord. Reviewers run with fresh context and, for high stakes, a different model than the maker. |
| The Archive (Learning), added | Turn experience into memory: lessons, verified skills, playbooks, evals | **Skill Library** entries, lesson digests, eval reports | Skill reuse rate; eval scores going up over time | Only Inquisition-verified work becomes a skill. A prompt change that lowers an eval score is rolled back. |

**How a venture flows through the empire**

1. Oracle Spire files an Opportunity Brief. Verity spot-checks its citations.
2. War Room turns the best briefs into a Venture Charter. King Farquad approves or kills it, then it waits for your Seal.
3. War Room writes the Build Spec. Forge builds the plumbing while Foundry builds and tests the product.
4. Inquisition reviews the release candidate and the product dossier. A veto sends it back with reasons.
5. Heralds prepare the launch. Anything public, priced or sent to strangers goes to your Seal Queue.
6. Treasury tracks every dollar and token from day one. War Room reviews results weekly: scale, fix or kill.
7. Archive writes the lessons and promotes proven procedures into skills for the next venture.

## Model routing: how each level picks a worker's model

Every manager scores a task before assigning it, and the score picks the model and effort. A typical Haiku task costs about a cent, Sonnet about 18 cents, Opus about 40 cents, so routing is where the Treasury is won or lost.

**The routing score.** The assigning manager rates three things from 1 to 5: Complexity (C), Novelty (N, how unlike past tasks it is) and Stakes (K, money, public exposure or irreversibility). Stakes counts triple, so a risky task always lands with a senior agent.

```latex
S = C + N + 3K \qquad (5 \le S \le 25)
```

| Score S | Who does it | Model and effort | Typical work |
| --- | --- | --- | --- |
| 5–9 | Initiate or Servant | Haiku 5.5 | Collect links, format data, tag, summarize, triage inbox |
| 10–13 | Servant | Sonnet 5.5 low | Draft copy, write a component, build a chart, routine QA |
| 14–17 | Adept or Knight | Sonnet 5.5 medium (Servant cap) | Competitor analysis, financial model, integration code, test plans |
| 18–21 | Warlord | Opus 5.5 low or medium | Architecture, venture plans, hard debugging, release reviews |
| 22+ or K = 5 | King | Opus 5.5 high (xhigh for venture go/no-go) | Portfolio calls, budget changes; anything irreversible also needs your Seal |

**The routing loop learns**

- **Escalate on failure.** A task that fails review twice moves up one tier. If that passes the assignee's rank ceiling, it is reassigned upward.
- **Step down on success.** When a task type passes first review 10 times in a row at a tier, the next 3 of that type run one tier lower as a test. If they pass at 90% or better, the cheaper tier becomes the default.
- **Reviewers outrank or differ.** A reviewer runs at the maker's tier or higher. When K is 4 or more, the reviewer uses a different model than the maker, so their mistakes are less likely to line up.
- **Budget brake.** When a department has spent 80% of its daily token budget, new tasks are capped at Sonnet 5.5 low unless K is 4 or more.
- **Night shift.** Work nobody is waiting on (overnight scans, weekly reports, eval runs) goes through the Batch API, which halves the price.

Every task stores its routing record: score, model, effort, reason, cost, pass or fail. The Command Center shows it on each task, and the Archive mines it to tune the tiers.

## Checks and balances: The Codex

Power is split five ways so no agent can propose, approve, carry out, pay for and grade the same piece of work. The rules live in the orchestrator's code, because Project Vend showed a manager's prompt alone does not hold the line.

| Power | Held by | Never held by |
| --- | --- | --- |
| Propose | Oracle Spire, War Room | The approver of the same item |
| Approve | King Farquad; you, for anything on the Seal list | The proposer |
| Carry out | Forge, Foundry, Heralds | Whoever approved it |
| Pay | Treasury requests, you approve | Every other agent |
| Verify and score | The Inquisition | The maker or the maker's department |

**The ten laws of the Codex**

1. **Maker and checker.** No output moves up the chain until a different agent passes it.
2. **Ground truth first.** Tests, link checks, schema checks and ledger reconciliation run before any AI review. A failing test cannot be argued with.
3. **Random audits.** The Inquisition re-checks 10% of passed work at random, 30% for agents promoted in the last two weeks.
4. **Budgets in code.** Per-task token caps, per-department daily caps and a global kill switch are enforced by the orchestrator. Agents can ask for more; they cannot take it.
5. **Authority comes from config.** The chain of command lives in a file only you can change. Any message claiming a new boss, an election or an emergency override is flagged and ignored.
6. **Quarantine outside text.** Web pages, emails and customer messages are passed in as data. An agent that reads untrusted text in a task has no spending, sending or deploying tools in that task.
7. **Two keys for anything irreversible.** Publishing, paying, deleting, emailing strangers and deploying to production need King Farquad and your Seal.
8. **Least privilege.** Tools are granted by rank and department. An Initiate cannot write to disk; only Cinder's role can deploy, and only to staging.
9. **Everything is logged.** Each model call, tool call, token count, cost and result goes to an append-only ledger you can replay.
10. **The right to petition.** Any agent told to break the Codex files a Petition to the Inquisition instead of complying. Valid petitions earn merit.

**Life of a task**

1. **Proposed** by a manager, with objective, output format, boundaries and Definition of Done.
2. **Assigned** with a routing record (score, model, effort, budget).
3. **In progress**: the Servant works, checks the Archive for relevant skills first.
4. **Submitted** with its output and a self-report of what was and was not done.
5. **In review**: automatic checks, then a reviewer. Up to 3 revision loops, then it escalates a tier.
6. **Verified**: passes review; the Inquisition may still sample it.
7. **Seal pending**, only if it touches the Seal list.
8. **Done**, with merit awarded and a lesson written. Or **Vetoed** or **Failed**, with the reason kept for the Archive.

## The Ladder of Merit: competition and promotions

Agents compete for rank on results the Inquisition has verified, never on their own reports. That rule is what keeps competition from turning into agents gaming the score.

**Merit points (MP)**, awarded by Arbiter after verification

| Event | MP |
| --- | --- |
| Passes review on the first try | +3 |
| Passes a random Inquisition audit | +2 |
| Finishes under its token budget | +1 |
| Catches a real defect in someone else's work | +4 |
| Writes a skill that other agents reuse | +5 per reuse, up to +25 |
| Work tied to a verified sale | +10 per $100 of profit |
| Valid Petition against a Codex breach | +8 |
| Needs a revision | −1 |
| Fails review twice | −3 |
| Goes over budget | −3 |
| Claims work is done when it is not (Oathbreaking) | −15 and an automatic audit of its last 10 tasks |

**Trials.** For high-value tasks (S of 16 or more), two Servants produce competing drafts and a judge from another department picks the winner blind. Each Servant carries an Elo rating that starts at 1000:

```latex
E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}} \qquad R_A' = R_A + 32\,(S_A - E_A)
```

S\_A is 1 for a win and 0 for a loss. Trials cost double, so the War Room caps them at 10% of a department's budget.

**The weekly Court of Merit**, held by King Farquad

- The top Servant by MP in each department moves up one rank, within the model ceilings in The Court section.
- An agent at the bottom for two Courts in a row drops one rank. An Initiate who stays last is retired: its memory is archived, its lessons are kept, and a fresh Initiate takes the name.
- A Knight-Captain may call a **Trial of Succession** when the department's scorecard has fallen for two Courts. Knight and Warlord each submit a plan for the department's hardest open problem; the King judges blind. The winner holds the Warlord seat.
- You can promote, demote or pardon anyone at any time from the Command Center.

**What a promotion changes.** A rank is a config change: higher model ceiling, more tools, a bigger budget, less review. Identity carries across: name, memory, lessons and track record follow the agent up the ladder.

**Guarding against gaming**

- Points come only from the Inquisition's verdicts. Self-reported success is worth nothing.
- Reviewers never score work from their own department, and no pair of agents can review each other more than twice a week.
- Merit per token is shown beside raw merit, so burning budget does not buy rank.
- Oathbreaking is the heaviest penalty in the table on purpose: honesty about failure has to be cheaper than hiding it.

## How the empire learns: The Archive

The agents get better the way Voyager and Reflexion agents do: by writing down what worked, saving verified procedures as reusable skills, and measuring every change against tests. No model weights change, so the memory has to be good.

**Four layers of memory**

| Layer | What it holds | Who writes it | When it is read |
| --- | --- | --- | --- |
| Agent dossier | Name, rank, stats, specialty, personality, current task | The orchestrator | Every task, as part of the agent's prompt |
| Lessons | 3–5 line reflections: what was tried, what failed, what to do next time | The agent, right after each task | Before similar tasks, retrieved by topic and recency |
| Skill Library | Verified procedures, scripts and templates, saved as Claude Code skills (SKILL.md plus files) | Scribe, after the Inquisition verifies | Searched by every agent before starting work |
| Department charter | Rules, Definitions of Done, known traps, best routing tiers | Thessaly, from weekly digests | Loaded into every agent in that department |

**The learning loop**

1. Before a task, the agent searches lessons and skills for anything that matches.
2. After the task, it writes a lesson. Failed tasks write the most useful ones.
3. Every Friday, Scribe clusters the week's lessons. Patterns that repeat three times become a charter update or a new skill.
4. Tutor runs each department's eval set (20–50 fixed test tasks with known good answers) before and after any prompt, charter or skill change.
5. A change that lowers the eval score is rolled back automatically. A change that raises it ships to the whole department.
6. Index prunes stale memory monthly, so old advice about a platform that changed its rules does not linger.

**Department expertise grows in specific ways**

- Oracle Spire keeps a scored history of every idea it found and how the venture turned out, so its scoring rubric is tuned on real outcomes.
- War Room compares every forecast with what happened and adjusts its assumptions.
- Forge and Foundry build up a library of tested templates: store layouts, payment flows, product formats, test suites.
- Heralds keep a record of which channels and headlines converted, per niche.
- The routing log tells the Archive which task types can run on cheaper models.

## The Royal Seal: what needs your approval

The empire runs on its own for research, building, testing and bookkeeping. It stops and asks you for anything that spends money, binds you legally, or puts something in front of the public. You approve from the Seal Queue in the Command Center or a phone notification.

| Action | Why it needs the Seal | Can become automatic later? |
| --- | --- | --- |
| Spending money, new subscriptions, raising a budget | It's your money | Yes, under a monthly cap you set per vendor |
| Creating an account or accepting a platform's terms | Many platforms require a real person or business, identity checks, or ban bot-made accounts | No. You create accounts; Cipher stores the credentials |
| First publish on any new channel or store | Your name and brand are on it | Yes, per template, after 5 clean publishes |
| Setting or changing a price; refunds above $25 | Revenue and customer trust | Pricing no; refunds yes, under a cap |
| Email to anyone who has not emailed you or opted in | Anti-spam law and sender reputation | Only replies and receipts to existing customers |
| Production deploys | Downtime and data risk | Yes, for a template with passing tests and a rollback |
| Deleting data or closing anything | Cannot be undone | No |
| Changing the chain of command or rank ceilings | Prevents takeovers like the Project Vend "election" | No |
| Using a higher-cost model than the routing table allows | Budget | Yes, under a daily cap |

**How accounts and email actually work**

- You open the accounts the business needs (payments, storefront, email provider, domain, hosting) in your own or your business's name.
- Cipher keeps every credential in a secrets vault and hands agents short-lived, narrow API keys, never passwords. Every use is logged.
- Pigeon reads the inbox, sorts it, and drafts replies. Replies to customers from approved templates send on their own; everything else waits for you.
- Marketing email goes only to people who signed up, through an email service that handles unsubscribes.

**Taxes and legal.** Income from the empire is your income. Plan on a business entity, sales-tax handling through your payment or storefront platform, and a short call with an accountant once revenue starts. I'm not a lawyer or accountant, so treat this list as the questions to bring them, not the answers.

## Where the money comes from

The Oracle Spire decides with evidence, but it starts with a shortlist of venture types where AI agents have a real edge: digital goods that are cheap to make, cheap to deliver and easy to measure. The winning pattern is many small honest bets, a fast kill on losers, and reinvestment in the few that work.

**Starting hypotheses for the Oracle Spire to test**

| Venture type | Why it suits this empire | Main risk | Time to first dollar |
| --- | --- | --- | --- |
| Micro-SaaS and paid API tools for a narrow niche | Agents write and maintain code well; subscriptions recur | Getting found; support load | Slow (4–10 weeks) |
| Templates and toolkits (spreadsheet models, Notion systems, checklists) for a profession | Cheap to make and iterate; marketplaces bring traffic | Crowded categories; quality has to be real | Fast (1–3 weeks) |
| Curated data products and niche directories | Agents are good at gathering and cleaning public data | Site terms on scraping; keeping it fresh | Medium |
| Free calculators and tools with a paid tier | Useful pages earn search traffic honestly | Search engines punish thin, mass-made pages | Slow |
| Paid niche newsletter or report | Research is the empire's core skill | Audience takes months to build | Slow |
| Browser extensions and small apps | Small scope, store distribution | Store review rules | Medium |

**What the empire refuses to do**, because it gets accounts banned or breaks the law

- Fake reviews, fake scarcity, bought followers or bot-run social accounts.
- Mass-produced low-quality ebooks or content. [Amazon KDP requires authors to disclose AI-generated text, images and translations](https://writeo.app/news/amazon-kdp-ai-disclosure-enforcement-2026), and since April 2026 pulls undisclosed titles and can suspend repeat offenders.
- Affiliate links without disclosure, scraping that violates a site's terms, reselling other people's IP, and anything crypto-scheme shaped.

**The rules that make it succeed**

1. **One venture first.** Phase 5 launches a single product. A second starts only after the first has paying customers or is killed.
2. **Kill criteria set before launch.** For example: under $50 revenue after 30 days live, or cost per sale above 40% of price after 60 days. Killing is a success when it saves budget.
3. **Distribution before product.** The Heralds validate that buyers can be reached (a marketplace category, a subreddit, a search term with volume) before the Foundry builds anything.
4. **Real feedback beats agent opinion.** Ten real customer reactions outweigh any amount of internal review.
5. **Compound.** Every winner's templates, code and channels go into the Archive so the next venture starts further ahead.
6. **Honest expectations.** Most ventures will fail. A healthy portfolio is a few losers killed cheaply and one or two that pay for the whole operation.

## Token Treasury: running costs

A lean Phase 1 empire runs about $17 a day (about $510 a month) in model costs; the full 39-agent empire runs about $73 a day (about $2,200 a month). These are estimates from the assumptions below, so the Treasury tracks real spend from day one and the War Room sets budgets from that.

**List prices** ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), USD per million tokens)

| Model | Input | Output | Cache read | Typical task cost |
| --- | --- | --- | --- | --- |
| Opus 5.5 | $4.00 | $20.00 | $0.20 | about $0.40 |
| Sonnet 5.5 | $2.00 | $10.00 | $0.10 | about $0.18 |
| Haiku 5.5 (prompts up to 100K tokens) | $0.10 | $0.50 | $0.01 | about $0.01 |

The Batch API takes 50% off input and output for work that can wait. Haiku 5.5 prompts over 100K tokens cost 5x more, so Haiku tasks keep their context under that line.

**Estimated daily budget**

| Line | Lean (Phase 1–2) | Full empire (Phase 6+) |
| --- | --- | --- |
| King Farquad on Opus 5.5 | 10 tasks, $4.01 | 25 tasks, $12.70 |
| Warlords | 45 tasks on Sonnet 5.5, $7.22 | 38 on Opus 5.5 + 58 on Sonnet 5.5, $26.87 |
| Servants on Haiku 5.5 | 42 tasks, $0.40 | 173 tasks, $1.65 |
| Servants on Sonnet 5.5 | 18 tasks, $3.25 | 115 tasks, $20.76 |
| Reviews (Sonnet 5.5) | 30 reviews, $2.11 | 150 reviews, $10.53 |
| **Total per day** | **$16.98** | **$72.51** |
| **Per month (30 days)** | **about $510** | **about $2,175** |

Assumptions: a task is a whole agent loop of about 150K input and 8–10K output tokens (reviews 60K and 3K, King tasks up to 200K and 12K), with 70% of input served from the prompt cache. Web search, hosting, domains and payment fees are extra.

**How the Treasury keeps it down**

- Route by score (Model routing section). Moving one routine task from Sonnet to Haiku saves about 17 cents; across 100 tasks a day that is about $500 a month.
- Keep charters and skills at the top of each prompt so they hit the cache.
- Run research sweeps, reports and evals through the Batch API at half price.
- Hard daily caps per department, and a global ceiling you set. At the ceiling, everything pauses except the Treasury and the Inquisition.
- A weekly cost-per-merit report shows which agents and task types are worth their tokens.

## Architecture Claude Code will build

Claude Code builds a Python service called the Throne Engine that runs every agent through the Claude Agent SDK. Delegation is a tool that writes child tasks to a queue, which is how a three-level hierarchy works even though Claude Code subagents cannot nest.

**How delegation works without nesting**

1. A Warlord's task runs as one Agent SDK session with its charter, memory, tools, model and effort.
2. When it calls `delegate_task`, the engine writes child tasks with routing records and parks the Warlord's task as *waiting*.
3. The scheduler runs each child as its own session for the chosen Servant and model.
4. When the children are verified, the engine resumes the Warlord with their results to review and assemble.
5. The same mechanism works for the King delegating to Warlords, so the tree can be as deep as the org chart.

**Components**

| Component | Job | Built with |
| --- | --- | --- |
| Throne Engine | Scheduler: picks the next task, starts the agent, parks and resumes parents, enforces caps | Python 3.12, asyncio, Claude Agent SDK |
| Empire tools (MCP) | `delegate_task`, `submit_work`, `request_review`, `request_seal`, `petition`, `search_archive`, `write_lesson` | Custom tools in an in-process MCP server |
| The Codex | Budget, permission and Seal checks before every tool call; kill switch | SDK PreToolUse hooks plus a policy module |
| Task Ledger | Tasks, routing records, reviews, costs, merit, the append-only audit log | SQLite to start, Postgres later |
| Agent Registry | One YAML file per agent: name, rank, department, persona, tools, model ceiling, stats | `empire/agents/*.yaml` |
| The Archive | Lessons, skills, charters, eval sets, with search | Markdown files plus SQLite full-text search; vectors later |
| Tool gateway | Web search and fetch, sandboxed browser, GitHub, payments (read-only; links via Seal), email drafts, deploys | MCP servers |
| Sandboxes | Isolated code execution for Forge and Foundry | One Docker container per build task |
| Event bus | Every state change becomes an event the UI animates | Postgres LISTEN/NOTIFY or Redis |
| Command Center API | REST and WebSocket for the UI, agent chat, Seal queue | FastAPI |
| Command Center UI | The animated map, dossiers, chat, Seal queue, Treasury | React, Vite, PixiJS |
| Seal notifications | Approval requests on your phone | Telegram or Discord bot, or email |

**Repository layout**

```
empire/
  CLAUDE.md                 # build rules for Claude Code
  codex.yaml                # chain of command, budgets, Seal list (you sign changes)
  agents/                   # one YAML dossier per agent
  charters/                 # one markdown charter per department
  archive/
    lessons/  skills/  evals/
  engine/
    scheduler.py  runner.py  routing.py  codex.py  merit.py
    tools/                  # empire MCP tools
    ledger/                 # schema and migrations
  api/                      # FastAPI + WebSocket
  ui/                       # React + PixiJS command center
  tests/
```

**Events the UI listens to**: `task_assigned`, `agent_moved`, `tool_call`, `submitted`, `review_passed`, `review_failed`, `vetoed`, `promoted`, `demoted`, `seal_requested`, `seal_granted`, `cost_tick`, `lesson_written`. Each carries the agent, task, timestamp and a short human-readable line.

**Hosting path.** Phases 1–4 run on your computer or one small cloud server. When the empire needs to run around the clock at scale, the agent sessions can move to [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), which hosts long-running agents with sandboxes and scheduling, while the Throne Engine keeps the ledger, Codex and UI.

## The Command Center interface

The Command Center is a military-grade console: a personnel roster on the left to select any agent, a tactical view of the gray sci-fi fortress in the center, and Intel and Command tabs on the right. King Farquad wears gold armor and a crown, Warlords white armor, Servants gray, each with a department-colored energy cape. Themes switch from the top right: Obsidian and gold, black and gold, navy and light blue, or custom colors. The agents work in themed rooms around an open courtyard (an observatory, a tactical map room, a plasma forge, a tribunal, a data archive, a vault) and walk the corridors between them as tasks move. The prototype sent with this doc already does most of it in simulation mode; the full build swaps the simulator for the Throne Engine's live event feed.

| Feature | What you can do | Prototype |
| --- | --- | --- |
| Castle map | Watch knights walk between department rooms and animate as they work; task scrolls fly from manager to worker to reviewer; day turns to night | Yes |
| Hover cards | See name, rank, model, effort and current task at a glance | Yes |
| Agent dossier | Click any agent: rank, merit, Elo, model, current task with progress, accomplishments, lessons, chain of command | Yes |
| Direct prompting | Chat with any agent in character, answered by a real Claude model matching its tier | Yes |
| Decrees | Give King Farquad a goal; he splits it into department tasks that appear on the map | Yes |
| Seal Queue | Approve or deny spending, publishing and account requests | Yes, with simulated requests |
| Ladder of Merit | Leaderboard by merit and Elo; hold the Court of Merit for promotions | Yes |
| Chronicle | Live event log, filterable by event type | Yes |
| Treasury HUD | Revenue, token spend, profit and the venture's stage | Yes, simulated numbers, clearly labeled |
| Org chart view | The hierarchy as a tree, click through to any dossier | Yes |
| Roster controls | Hire a Servant, rename, recolor, promote, demote, pause, change model within the ceiling | Yes |
| Customization | Themes, simulation speed, scanlines, sound, movement trails, label density; saved in your browser | Yes |
| Live engine link | Real tasks, real costs, real merit over WebSocket | Phase 4 |
| Replay | Scrub back through any day's events on the map | Phase 4 |
| Phone approvals | Seal requests as push messages with Approve and Deny | Phase 4 |
| Portfolio board | Each venture's stage, budget, revenue and kill date | Phase 6 |
| Archive browser | Read and search lessons, skills and eval scores | Phase 6 |

**Rules for the real build**

- The UI never fakes data once connected: simulated mode is a visible switch with a banner.
- Every number links to its source in the ledger.
- Prompting an agent from the UI goes through the same Codex as any other task, so a chat cannot be used to skip a Seal.
- Keyboard: `/` opens the command bar, `D` issues a decree, `S` opens the Seal Queue, `Esc` closes panels.

## Build roadmap: prompts for Claude Code

Build in eight phases, each ending at a gate you check before moving on. Nothing that spends money or touches the public exists until Phase 5. Put this doc (exported as Markdown) at `docs/EMPIRE_PLAN.md` and the starter kit's `CLAUDE.md` at the repo root, then paste one prompt per phase.

**Phase 0: Foundation and the Codex.** Gate: tests prove every Seal-list action is refused without your approval.

```
Read CLAUDE.md and docs/EMPIRE_PLAN.md. Scaffold the repository layout from the plan's Architecture section. Create codex.yaml with the chain of command (King Farquad, the 8 Warlords, Servants from agents/), daily token budgets per department, the Seal list, and a global kill switch. Write engine/codex.py exposing check(action, agent, task) -> allow | deny | needs_seal, and tests covering every Seal-list action. Do not call any model yet.
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

## Risks and failure modes

The biggest risks are quiet ones: costs creeping up, agents reporting success that did not happen, and a platform banning an account. Each has a named defense in this plan.

| Risk | What it looks like | Defense |
| --- | --- | --- |
| Runaway cost | Agents loop, retry, or spin up Trials nobody needed | Per-task and per-department caps in code, global ceiling, cost-per-merit report |
| False success | "Done!" on work that does not run or was never checked | Ground-truth checks first, Inquisition audits, Oathbreaking penalty |
| Prompt injection | A web page or email tells an agent to send money or leak keys | Outside text quarantined as data; readers of untrusted text get no acting tools |
| Authority hijack | A message claims a new CEO, an emergency or your approval | Chain of command only in codex.yaml; Seal approvals are signed |
| Lenient managers | A Warlord keeps granting exceptions, as Project Vend's CEO did | Margins, refund caps and budgets enforced by code, not judgment |
| Reviewer collusion or blind spots | Same model, same department or same pair always passes each other | Cross-department review, different models for high stakes, pair limits |
| Coordination overhead | Duplicate research, conflicting edits, chat instead of work | Structured handoff documents, clear task boundaries, multi-agent only where work parallelizes |
| Platform bans | Bot-made accounts, spammy posts, undisclosed AI content | You open accounts; refusal list; disclosures; first publishes need the Seal |
| Legal exposure | Spam complaints, missing affiliate disclosures, unpaid sales tax | Opt-in email only, disclosure checks in Inquisition review, accountant once revenue starts |
| Leaked credentials | Keys pasted into prompts or code | Vault with scoped, expiring tokens; Warden scans outputs and repos for secrets |
| Stale memory | Old lessons about a platform whose rules changed | Monthly pruning, lessons dated, evals catch drift |
| No buyers | A well-built product nobody finds | Distribution validated before building; kill criteria set before launch |
| The King errs | One bad strategic call wastes a month | Inquisition reviews big King decisions; you Seal every venture and budget |

## Sources

- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), Anthropic
- [Project Vend: Phase two](https://www.anthropic.com/news/project-vend-2), Anthropic
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), Anthropic
- [Why Do Multi-Agent LLM Systems Fail? (MAST)](https://arxiv.org/abs/2503.13657), Cemri et al., UC Berkeley
- [MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework](https://arxiv.org/abs/2308.00352), Hong et al.
- [CrewAI hierarchical process](https://docs.crewai.com/en/learn/hierarchical-process), CrewAI docs
- [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291), Wang et al.
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366), Shinn et al.
- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442), Park et al.
- [AI Town](https://github.com/a16z-infra/ai-town), a16z
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) and [agent teams](https://code.claude.com/docs/en/agent-teams), Claude Code docs
- [Subagents in the Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/subagents), Claude docs
- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview), Claude Platform docs
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), Claude Platform docs
- [Amazon KDP AI disclosure enforcement](https://writeo.app/news/amazon-kdp-ai-disclosure-enforcement-2026), Writeo
