# Plan: Incorporating Skills, Hooks, and MCP into the 4-role system

Architect-authored, assembled section-by-section by the CPO as each section
call completes. Skeleton (14 sections) approved 2026-09-21.

## Skeleton

| # | Section | What it will cover |
|---|---------|---------------------|
| 1 | Goals & non-goals | What adopting Hooks/Skills/MCP is meant to buy this system (enforcement, repeatability, persistent memory) and what is explicitly out of scope for this round. |
| 2 | Placement principle: Hook vs Skill vs MCP vs prompt | The decision rule for routing any given need to one of the four mechanisms, so later sections can cite it instead of re-arguing. |
| 3 | Role–capability matrix | Per role (Architect / CPO / Manager / Worker levels): which hooks apply, which skills it may invoke, which MCP tools it may see — and what stays denied. |
| 4 | Hooks proposal A: role-constraint enforcement | PreToolUse hooks that programmatically enforce the currently prompt-only hard constraints (CPO no Write/Edit/WebSearch/Bash, Manager confined to `knowledge/`, Architect read-only). |
| 5 | Hooks proposal B: state, lifecycle & concurrency automation | Extending the existing SessionStart re-injection with PreCompact/Stop/PostToolUse hooks for roster upkeep, progress-memo stamping, and spawn-cap checking at spawn time. |
| 6 | Skills proposal A: CPO orchestration skills | Packaging the CPO's repeated procedures — spawning a job's Worker wave, converting a Plan section into a Worker task spec, running a knowledge-file compaction pass. |
| 7 | Skills proposal B: Architect, Manager & Worker skills | Skills for the skeleton-then-sections Plan protocol, the Question format, Manager write templates, and standard Worker report/review formats. |
| 8 | Skills authoring & invocation conventions | Naming, description-matching vs explicit invocation, inline vs subagent handoff, file layout under `.claude/skills/`, and how skills relate to the existing agent definitions. |
| 9 | MCP proposal A: knowledge store migration | Replacing the flat `knowledge/` markdown files with an MCP-backed structured store, and the stable interface contract that keeps CLAUDE.md's existing promise intact. |
| 10 | MCP proposal B: other candidate servers & exposure rules | Which additional external servers are worth wiring, and how their tools are scoped per role without breaking the delegation model. |
| 11 | Interaction & conflict risks | Where hooks, skills, MCP tools, and existing prompt rules can collide (block-retry loops, context bloat, double-counted caps, hook/skill ordering) plus mitigations. |
| 12 | Prioritization & phased rollout | Tiered sequence — what to build first, next, later — with effort-vs-payoff rationale and the dependency edges between phases. |
| 13 | Decisions requiring the user | The explicit choices to surface before implementation (permission tightening, external dependencies, knowledge migration, agent-definition edits). |
| 14 | Validation & rollback | How each phase is verified as working in practice, and how to back it out cleanly if it disrupts the existing workflow. |

Ordering rationale: sections 1–3 fix the frame, 4–10 are the three
capability proposals within that frame, 11–14 are cross-cutting guardrails,
sequencing, and hand-off to the user.

Scheduling notes from the Architect: sections 4, 5, 6, 9 are the heaviest —
give each its own call with relevant friction points pasted in. Section 3
depends on 2; section 12 depends on 4–10 being drafted first, so call 12
and 13 last.

## 1. Goals & non-goals

### 1.1 What this round is trying to buy

Today the four-role system is enforced entirely by prose: CLAUDE.md tells the CPO not to write code, the Architect's role file tells it not to search, and concurrency caps exist as a table a model is asked to re-read before every spawn. Prose is advisory — it degrades under long context, compaction, and unusual task framing. Hooks, Skills, and MCP are the three mechanisms available that turn parts of that prose into something the runtime actually applies. The goals, in priority order:

| # | Goal | Mechanism it leans on | Why it matters here |
|---|---|---|---|
| G1 | Make role constraints *enforced* rather than *stated* | Hooks | "CPO must not edit code", "Architect is Read-only", "Manager writes only under `knowledge/`" are currently honor-system rules that a single confused turn can violate. |
| G2 | Make state/lifecycle bookkeeping automatic | Hooks | `active-agents.md` roster add/remove and progress-memo appends are mechanical, high-frequency, and easy to forget — exactly the class of work that should not consume CPO judgment or tokens. |
| G3 | Stop re-authoring the same orchestration prompts by hand | Skills | The CPO writes each Worker task spec from scratch every time. Recurring patterns (briefing the Architect, spawning a Worker at a chosen level, compacting `knowledge/`) should be packaged once and invoked, not retyped. |
| G4 | Give `knowledge/` real persistence and structure | MCP | CLAUDE.md already calls the flat-markdown store "a placeholder for a future MCP-backed knowledge store." This round should define the migration path and the interface contract that keeps the same surface when it's swapped. |
| G5 | Reduce CPO context pressure | All three | Every rule moved into a hook, every prompt moved into a skill, and every lookup moved behind an MCP call is text the CPO no longer has to carry in-window. |

A secondary goal, implicit in all of the above: **make violations visible**. Even where a hook can't safely block an action, it should be able to log or warn, so drift is detectable after the fact rather than silent.

### 1.2 Explicitly out of scope for this round

- **The four-role hierarchy itself.** Architect / CPO / Manager / Worker stays as-is. This plan adapts tooling to the hierarchy, not the hierarchy to the tooling.
- **New roles or new levels.** No fifth role, no new Worker tier, no splitting the Architect by area beyond what the existing per-area concurrency rule already allows.
- **Model assignments and escalation policy.** Who runs on Haiku/Sonnet/Opus, and the Senior-Worker-Opus approval path, are unchanged and not re-litigated here.
- **Concrete MCP server selection.** Sections 9–10 define *what capabilities* we'd want behind MCP and *what rules* govern exposure per role; choosing specific servers (vendor, hosting, auth) is a user decision, deferred to section 13.
- **Anything requiring execution.** No hook scripts, skill files, or config are written as part of this plan — this is a design document the CPO turns into Worker tasks.
- **Agent-definition file edits.** Changes under `.claude/agents/` still require explicit user approval per CLAUDE.md; this plan may *recommend* such edits but does not authorize them.

### 1.3 Success criteria for the round

The round succeeds if: (a) every rule in CLAUDE.md is classified as enforced-by-hook, encoded-as-skill, backed-by-MCP, or deliberately left as prose; (b) no proposal requires changing the role hierarchy; and (c) the phased rollout in section 12 has a first phase small enough to ship and validate independently.

## 2. Placement principle: Hook vs Skill vs MCP vs prompt

Sections 4–10 each propose moving something out of prose. This section fixes the rule they cite, so placement is argued once here rather than re-litigated per proposal.

### 2.1 The four mechanisms at a glance

| | Trigger | Binding? | Holds state? | Context cost | Who can change it |
|---|---|---|---|---|---|
| **Hook** | Deterministic, at a tool-call or lifecycle boundary | Yes — can deny the call | Only what it writes to disk | ~Zero until it fires | Worker edit + user review of config |
| **Skill** | Model elects to invoke it, by name/description match | No — advisory | No | Description always loaded; body only on invoke | Worker edit, normal file |
| **MCP** | Model elects to call a tool | No (but the server can refuse) | Yes — that's the point | Tool defs loaded per agent that gets the server | Config + external service |
| **Prose** | Always in effect, always read | No — advisory | No | Paid on every turn, by every agent that loads it | Anyone; CLAUDE.md edits are cheap |

### 2.2 What each is actually good and bad at *here*

**Hooks** are the only mechanism in this system that converts a stated rule into an enforced one. They are right when the rule is expressible as a predicate over data present at a tool-call boundary (which tool, which arguments, which paths, which agent) and when a violation is genuinely damaging. They are wrong whenever judgment is required: a hook cannot tell a legitimate exception from a violation, and when it denies wrongly the CPO is the worst-placed role to fix it — the CPO cannot write code, so every false denial becomes a Worker round-trip. Hooks also fail opaquely and apply to *all* agents including subagents, so "can the hook actually distinguish which role is calling?" is a precondition, not a detail. Treat mechanizability as a design pressure: a rule worth enforcing is worth restating in a form a predicate can evaluate.

**Skills** are the right home for recurring *procedure with judgment* — the multi-step sequences the CPO retypes from memory (brief-the-Architect, spawn-a-Senior-Feature, compact the memo). Their value is twofold: the procedure stops drifting between invocations, and the body stays out of context until needed, which directly serves G5. Their weakness is that invocation is the model's choice: a Skill never guarantees anything. Never use one where the failure mode of *not* invoking is a violated constraint rather than a sloppier result.

**MCP** earns its cost only when a need is genuinely stateful, structured, or external — durable storage, queries a file read can't answer, state shared across sessions or agents. Its costs are real and recurring: setup and operational failure modes, plus tool definitions consuming context in every agent exposed to the server. A handful of markdown files that are read whole and appended to is not an MCP-shaped problem; a knowledge store that must be queried by topic, deduplicated, and survive compaction is.

**Prose** remains the default and is not a failure state. It is the only mechanism that can express conditional, social, or judgment-laden rules ("ask the user before X"), it is editable instantly by anyone, and it carries the *why* that mechanisms cannot. Its costs are that it is advisory, unverifiable, and paid on every turn by every agent that loads it.

### 2.3 The decision procedure

Apply in order; stop at the first match.

1. **Is the need stable and recurring?** If it has come up once, or the shape is still moving — **prose**. Do not mechanize a guess.
2. **Must a violation be impossible, not merely discouraged?** If yes, ask the precondition: *can a predicate over a single tool call or lifecycle event decide it, using data the hook can see?* If yes — **hook (gate)**. If no, the rule is not currently enforceable: either reshape it until a predicate can decide it, or leave it in **prose** and accept advisory status. Never answer this question with a Skill.
3. **Should a side effect happen every time, regardless of whether the model remembers?** Roster rows, memo appends, re-injection after compaction, lifecycle bookkeeping. If yes — **hook (side effect)**, on the lifecycle event that already marks the moment.
4. **Is it a multi-step procedure the CPO would otherwise re-author by hand, where getting it slightly wrong is a quality problem rather than a constraint breach?** If yes — **skill**.
5. **Does it need durable state, structured query, or an external system that files cannot provide?** If yes — **MCP**, and specify which roles get the server exposed.
6. **Otherwise — prose.**

### 2.4 Combinations, anti-patterns, and promotion

**Most real needs land on a pair, not a single mechanism.** The canonical composition: prose states the intent, a Skill carries the procedure, a hook enforces the one invariant the procedure must not break, and MCP holds whatever the procedure reads and writes. When sections 4–10 propose a mechanism, they should name the complementary layers explicitly rather than implying the mechanism stands alone.

**Anti-patterns to reject on sight:**
- A hook standing in for judgment — produces false denials the CPO structurally cannot debug.
- A Skill used to enforce a constraint — advisory dressed as binding.
- MCP for what a file read already does — pure context and ops cost.
- Prose duplicating a rule a hook already enforces — the two drift, and the prose copy is the one that silently goes stale. Once enforced, prose should explain *why* and point at the enforcement, not restate the rule.

**Promotion rule.** Everything starts as prose. Promote on evidence, not anticipation: a repeated violation promotes to a hook; a repeated hand-authoring promotes to a Skill; repeated inability to find or trust what is in `knowledge/` promotes to MCP. Demotion is equally legitimate — a hook that mostly fires on legitimate work should go back to prose rather than accumulating exceptions.

## 3. Role–capability matrix

Sections 4–10 will propose specific hooks, Skills, and MCP servers. This section fixes, in advance, **who gets access to what** once they exist — so each proposal only has to argue *what the mechanism does*, not *which roles see it*. Nothing here drafts a mechanism; the labels below are placeholders that sections 4–10 fill in.

### 3.1 Three enforcement tiers, in cost order

Section 2 ranked mechanisms by trigger and bindingness. Applying it per-role adds one refinement: **whole-tool denial and conditional denial are different tiers, and the cheaper one wins.**

| Tier | Use when | Cost | Change requires |
|---|---|---|---|
| **T1 — tool allowlist** in the agent definition | The role must *never* use the tool at all, under any argument | Zero runtime, zero context | User approval (per CLAUDE.md) — this plan may only recommend |
| **T2 — hook** | The tool is legitimately needed, but only for certain arguments/paths/moments | Runs per call; false denials cost a Worker round-trip | Worker edit + user review of hook config |
| **T3 — prose** | The rule needs judgment, or is conditional on intent rather than arguments | Paid every turn by every agent that loads it | Anyone |

The rule for every row below: **never use T2 where T1 suffices, and never use T2 where the predicate needs judgment.** A hook that duplicates an allowlist is pure overhead; a hook standing in for judgment produces false denials the CPO structurally cannot debug.

### 3.2 Hook class and Skill set labels

Forward references, defined in sections 4–5 (hooks) and 6–8 (Skills):

- **H-GATE** — conditional role-boundary denial at `PreToolUse`.
- **H-ADMIT** — admission control on spawn calls (concurrency caps).
- **H-BOOK** — automatic bookkeeping side effects at `PostToolUse` / `SubagentStop`.
- **H-BOOT** — session/compaction context re-injection at `SessionStart` / `PreCompact`.
- **H-AUDIT** — passive, non-blocking logging.
- **S-ORCH** — CPO orchestration Skills. **S-PLAN** — Architect Skills. **S-BOOK** — Manager Skills. **S-EXEC** — Worker Skills.
- **KS** — the `knowledge/` MCP store (section 9), with scopes `read`, `write-note`, `write-doc`, `roster`.

### 3.3 The matrix

| Role | Hooks that apply | Skills discoverable | MCP exposure | Denied outright (tier) |
|---|---|---|---|---|
| **Architect** | H-AUDIT only | S-PLAN | `KS:read` | All writes/edits, all execution tools, network/search (T1 allowlist — already Read-only); spawning (T1) |
| **CPO** | H-GATE, H-ADMIT, H-BOOK, H-BOOT, H-AUDIT | S-ORCH | `KS:read`, `KS:write-note`, `KS:roster` | Code writes outside `knowledge/` (T2); external API calls (T2); search/gather (T2 + T3); `KS:write-doc` is *allowed* — the CPO saves Architect plans |
| **Manager (J/M)** | H-GATE, H-BOOK, H-AUDIT | S-BOOK | `KS:read`, `KS:write-note`, `KS:write-doc`, `KS:roster` | Any write outside `knowledge/` (T2 path predicate); spawning (T1); deciding content (T3) |
| **Worker — Junior** | H-GATE (scope), H-BOOK, H-AUDIT | S-EXEC (mechanical subset) | none | Spawning (T1); `knowledge/` writes (T2); network/search (T1) |
| **Worker — Middle** | H-GATE (scope), H-BOOK, H-AUDIT | S-EXEC | none, or `KS:read` if briefed | Spawning (T1); `knowledge/` writes (T2); network/search (T1 or T3 — see 3.5) |
| **Worker — Senior** | H-GATE (scope), H-BOOK, H-AUDIT | S-EXEC + review/search Skills | `KS:read`; external servers per section 10 | Spawning (T1); `knowledge/` writes (T2); autonomous scope expansion (T3) |

### 3.4 Row-by-row justification

**Architect.** The Architect's constraints are already at T1: its definition is Read-only, so "never writes code" needs no hook — adding one would violate the no-double-mechanization rule from section 2. Its *remaining* constraints ("don't design outside the scoped ask", "don't complete the whole plan in one call") fail section 2's precondition test: no predicate over a tool call can distinguish a well-scoped section from an overreaching one. Those stay prose permanently. `KS:read` is the one addition worth making — it needs the material the CPO feeds it, and read-only MCP access lets the CPO cite a store key instead of pasting file contents, which serves G5 without weakening any constraint. No H-GATE row exists because there is nothing left to conditionally gate.

**CPO.** The CPO is the only role that carries the full hook set, because it is the only role whose constraints are *conditional rather than absolute*. It must write to `knowledge/` but not to code; it must spawn agents but not past a cap. Both are exactly section 2's step-2 case: damaging if violated, decidable from the arguments of a single call (target path; current roster count). H-ADMIT is the highest-value row in this table — concurrency caps are currently enforced by the CPO reading a file and doing arithmetic from memory, which is the definition of a rule that should be a predicate. H-BOOK and H-BOOT attach here because the CPO owns the roster and the memo, and section 2's step 3 says a side effect that must happen every time belongs on the lifecycle event, not on the model's attention. "Don't make structural decisions" stays T3 — unmechanizable, and correctly so.

**Manager.** Nearly the inverse of the Architect: its scope restriction (`knowledge/` only) is a clean path predicate, so T2 applies, but its defining constraint — *never decide what is worth recording* — is pure judgment and stays prose forever. A Manager therefore gets the widest KS write surface of any role and the narrowest decision latitude. Junior and Middle share one row because the level difference is batch size, not permission: nothing a Middle Manager may touch is off-limits to a Junior one. The single-active-Manager cap is enforced by H-ADMIT on the *CPO's* spawn call, not by anything inside the Manager.

**Workers.** All three levels share the same denial set; they differ only in which Skills are discoverable and whether they see any MCP at all. The deliberate asymmetry: **Workers write code but not memory.** Letting Workers write to `knowledge/` would break CLAUDE.md's rule that the CPO alone decides what gets recorded — so that is a T2 path predicate, symmetric to the Manager's gate and pointing the opposite way. Workers get no KS write scope for the same reason. Junior sees a mechanical Skill subset rather than the full set purely for context economy and misfire reduction — a Haiku agent offered a planning Skill is more likely to invoke it wrongly than usefully. Senior is the only Worker level with outward exposure, matching its existing web-search permission. The Senior level-fit check and the Task/Feature distinction stay prose: both are judgment calls made before any tool is touched.

### 3.5 Cross-cutting rules

1. **Deny-by-default for MCP.** A server is exposed to a role only if this matrix lists it. New servers proposed in section 10 must name their rows here or default to none.
2. **Hooks need to know who is calling.** Every H-GATE row assumes the hook can identify the invoking role. If it cannot, that row collapses to T3 prose — this is a precondition for sections 4–5, not an afterthought.
3. **Skills are discoverability, not permission.** A Skill listed for a role is advisory; a Skill *omitted* is not a security boundary. Anything that must not happen needs a T1 or T2 row, never a Skill omission.
4. **Junior/Middle/Senior differ in Skills and exposure, never in denials.** If a future proposal wants a permission that exists at one Worker level and not another, it must justify splitting the row rather than assuming it.

### 3.6 Deferred to section 13

Three exposure questions need the user, not this plan: (a) whether Middle Workers get search access or it stays Senior-only; (b) whether the Architect's `KS:read` is broad or scoped to CPO-nominated keys; (c) any T1 allowlist change implied above — all agent-definition edits require user approval, so this section recommends and does not enact.

## 4. Hooks proposal A: role-constraint enforcement

### 4.1 The load-bearing precondition

Every H-GATE row in section 3.3 assumes a hook can identify which role is making the call. That assumption is unverified. Before any hook in this section is built, four questions need answering:

1. Does the hook payload expose the invoking agent's role/level, or only the tool name and arguments?
2. If not exposed directly, can it be reconstructed from the session/agent ID by cross-referencing `active-agents.md` at call time?
3. Is that cross-reference reliable mid-spawn (i.e., is the roster row written before the agent's first tool call, or after)?
4. Does the answer differ between a locally-spawned subagent and a resumed instance (`SendMessage`)?

Recommendation: before committing to any hook in the table below, spend one Middle Worker spike verifying (1)–(4) against the actual hook payload shape. Everything in 4.2–4.4 is written conditional on that spike's outcome and should be treated as a design sketch, not a build order.

### 4.2 Three identity strategies

- **Strategy A — per-agent hook config.** Each agent definition (`.claude/agents/*.md`) carries its own hook configuration, so identity is implicit in which config fired. Cleanest option if the platform supports it, but it's an agent-definition edit, and CLAUDE.md requires user approval before editing those — so Strategy A cannot be adopted unilaterally even if the spike confirms it works.
- **Strategy B — spawn-time correlation via sidecar file.** The CPO writes a small sidecar (agent ID → role/level/job) at spawn time; the hook reads it at call time to resolve identity. Works with a single global hook, but adds a file the CPO must keep in sync and a race if the hook fires before the sidecar write lands.
- **Strategy C — route through MCP instead of identifying the caller.** Don't gate generic `Write`/`Edit` under `knowledge/` at all; instead expose `knowledge/` mutation only through MCP KS tools (section 9), and forbid the raw filesystem tools under that path for every role via a single path-predicate hook that needs no identity check at all. This eliminates two of the four hook families below (H-GATE-MGR-PATH and H-GATE-WORKER-KS collapse into "the tool doesn't exist for you") at the cost of depending on section 9 existing first — recommended as the fallback if the spike shows Strategies A/B are unreliable.

### 4.3 The hooks table

| Hook | Event | Predicate | On violation | Failure mode |
|---|---|---|---|---|
| **H-GATE-CPO-WRITE** | `PreToolUse` (Write/Edit) | Caller role = CPO AND path not under `knowledge/` | Deny | Recoverable (CPO can re-target the call) → fail closed |
| **H-GATE-CPO-NET** | `PreToolUse` (WebSearch/WebFetch/Bash) | Caller role = CPO | WebSearch/WebFetch → deny; Bash → **ask** (Bash is overloaded — most CPO Bash calls are benign, e.g. checking `active-agents.md` counts) | Split: deny branch fails closed, ask branch is a human-in-the-loop escape hatch |
| **H-ADMIT** | `PreToolUse` (Agent/spawn) | Resolved job/area roster count (from `active-agents.md`) already at cap for the requested role/level | Deny | Fail closed on cap-breach or missing job/area tag; fail open (+ H-AUDIT) if the roster file itself is unreadable — an infra failure, not a caller mistake |
| **H-GATE-MGR-PATH** | `PreToolUse` (Write/Edit) | Caller role = Manager AND path not under `knowledge/` | Deny | Recoverable → fail closed |
| **H-GATE-WORKER-KS** | `PreToolUse` (Write/Edit) | Caller role = Worker (any level) AND path under `knowledge/` | Deny | Recoverable → fail closed |

H-ADMIT depends on a spawn-prompt tagging convention that doesn't exist yet: the `Agent` tool schema carries no job/area field today, so the hook has nothing to key its roster lookup on unless the CPO's spawn prompts start embedding a `JOB:`/`AREA:` tag the hook can parse out of the prompt text. This is a new convention this section is proposing, not something section 3 already assumed. H-ADMIT also has a hard ordering dependency: it must not go live before H-BOOK (section 5) does, because right now the roster is updated by the CPO editing the file by hand — any lag between an agent reporting back and the CPO remembering to remove its row would cause H-ADMIT to see stale (too-high) counts and deny legitimate spawns. H-BOOK making that removal automatic on `SubagentStop` is what makes H-ADMIT's counts trustworthy.

### 4.4 Failure semantics

The organizing question for every row above is not "is this violation severe" but **"can the caller remedy this denial by changing its next call?"** If yes — a bad path, an over-cap spawn — failing closed is safe and correctly load-bearing: the caller retries with a corrected call. If no — the roster file is unreadable, the hook process itself errors — failing closed would silently freeze the whole role, which is worse than the constraint it was meant to enforce. Those cases always fail open and log to H-AUDIT so the CPO (or the user) notices the gap instead of it being silent. H-ADMIT is the one row with a genuine split (see table): the cap check fails closed, but roster-unreadable fails open. Given the identity precondition in 4.1 is unverified, every hook in this table should ship on a **three-stage rollout ladder** rather than going straight to enforcement: (1) audit-only — log what *would* have been denied; (2) ask — prompt the CPO/user before proceeding; (3) deny. Move a hook to the next stage only after its audit log shows no false positives over some observation window.

### 4.5 What stays prose

Recorded here so sections 5–10 don't re-attempt mechanizing these: "the CPO decides what's worth recording" (Manager's constraint — pure judgment, no predicate exists); "the Architect stays scoped to what was asked" (no predicate distinguishes a well-scoped answer from scope creep); "a Senior Worker correctly judges Task vs Feature" (judgment call, already prose per the Task/Feature protocol); model/escalation approval itself (already a human-in-the-loop step, not a candidate for automation).

### 4.6 Dependencies this section creates

1. The section 4.1 spike (caller-identity verification) must run before any row in 4.3 is built — everything here is provisional on its outcome.
2. H-BOOK (section 5) must exist and be reliable before H-ADMIT is promoted past audit-only, per 4.3's ordering note.
3. Strategy C (4.2) depends on section 9 (the KS MCP tools) existing first — it cannot be adopted before that section is drafted.
4. The `JOB:`/`AREA:` spawn-prompt tagging convention this section proposes for H-ADMIT needs to be reflected in section 6 (or wherever spawn-call conventions are finalized) so it isn't designed twice.
5. Strategy A (per-agent hook config) requires user approval before adoption, same as any agent-definition edit — this section recommends, it does not enact.
6. Sections 5–10 should treat 4.5's list as settled and not re-open whether those specific constraints are mechanizable.

## 5. Hooks proposal B: state, lifecycle & concurrency automation

Section 4 made role constraints enforceable. This section makes the *state those constraints read* true by construction. Its centerpiece is the roster: `knowledge/active-agents.md` is currently maintained by the CPO editing a file by hand, and H-ADMIT cannot be promoted past audit-only while that is so. H-BOOK is therefore not a convenience row — it is the unblocking dependency for section 4's highest-value hook.

Scope here is **H-BOOK** (bookkeeping side effects), **H-BOOT** (session/compaction re-injection), and **H-AUDIT**, which sections 3 and 4 both referenced without anyone owning it. H-GATE and H-ADMIT are section 4's and are not re-litigated.

### 5.1 The invariant to aim at

State the target sharply, because it changes the design: the goal is **not** "the roster gets updated reliably." It is:

> The roster is accurate *by construction* — there is no moment at which an agent is running and unlisted, or listed and finished.

A hook that reminds, retries, or reconciles after the fact still leaves windows where H-ADMIT reads a lie. The design below closes the window rather than narrowing it.

### 5.2 Identity at lifecycle events — and how to not need it

Section 4.1's precondition applies here too, but the shape is different, and in one direction it is worse.

`SubagentStop` fires on the agent object itself rather than being inferred from a tool call's caller, so *type* identity should be easier to obtain. But type is not what roster removal needs. The caps contemplate three concurrent Junior Workers; knowing "a `worker-junior` stopped" does not say **which row to delete**. Roster removal needs a **per-instance** identifier, and that is a strictly harder identity problem than section 4's, not an easier one.

The resolution avoids the problem entirely, and it rests on one structural fact worth stating plainly:

> **The `Agent` spawn tool is synchronous.** The call does not return until the subagent has finished. So `PreToolUse` on that call is the moment the agent starts, and `PostToolUse` on the *same* call is the moment it ends.

That gives a matched pair of events on a single tool call, both carrying the identical `tool_input`. Roster addition and removal can therefore be keyed on the call itself — via the tool-use identifier if the payload exposes one, or a hash of `tool_input` otherwise — with **no subagent identity required at any point**. `SubagentStop` becomes optional rather than load-bearing.

Three consequences worth carrying forward:

1. H-ADMIT and roster-addition sit on the *same* event. Admission check then row-write is one ordered sequence; a denied spawn writes no row, so orphans cannot be created by a block.
2. Parallel spawns are fine — each concurrent `Agent` call gets its own Pre/Post pair.
3. The one real gap is abnormal termination: if the session dies mid-call, `PostToolUse` never fires and the row leaks. That is what H-BOOK-GC exists for (5.3), and it is a rare, self-healing case rather than a routine one.

This is the same move as section 4's Strategy C: restructure until identity stops mattering. Note it also means H-BOOK does **not** depend on the section 4.1 spike resolving favorably — a genuine scheduling advantage, and a reason H-BOOK can precede the rest.

### 5.3 The hook rows

| Name | Event | Action | Blocking? |
|---|---|---|---|
| **H-BOOK-ADD** | `PreToolUse` on the `Agent` tool, ordered after H-ADMIT | Append roster row: role, level, job/area (from the section 4.3 tag), task summary, start time, call key | Never |
| **H-BOOK-REMOVE** | `PostToolUse` on the `Agent` tool | Delete the row matching the call key | Never |
| **H-BOOK-GC** | `SessionStart` | Sweep orphaned rows from prior sessions; set roster-health flag | Never |
| **H-AUDIT** | `PostToolUse` (broad) + every hook decision | Append-only event log to a machine-owned file | Never |
| **H-BOOT-INJECT** | `SessionStart`, keyed on source | Re-inject roster + memo pointer into context | n/a |
| **H-BOOT-SNAP** | `PreCompact` (optional) | Snapshot volatile state before context is lost | n/a |

**H-BOOK-ADD.** Extracts what it needs from `tool_input`: `subagent_type` gives role and level directly; the job/area comes from the structured tag line section 4.3 already mandates; the task summary can be the prompt's first sentence, truncated. Nothing here requires judgment, which is exactly why it qualifies as a hook under section 2's step 3 rather than needing a Skill.

**H-BOOK-REMOVE.** The row this deletes was written by its own paired Pre call, so matching is exact rather than heuristic. Recommend it also write a completion line to H-AUDIT's log, giving duration for free — useful later for section 14's validation and for spotting Workers that habitually overrun their level.

**H-BOOK-GC.** Handles the abnormal-termination gap. On session start, any row whose paired call cannot have survived (previous session, no matching completion) is swept. This is also where the **roster-health flag** is set: if GC finds orphans, or the roster file is malformed, it marks the roster untrusted, and H-ADMIT — per section 4.4's "fail open when the predicate cannot be evaluated" — degrades itself to audit-only until the flag clears. That coupling is deliberate: it makes bookkeeping failure produce *reduced enforcement* rather than *wrong enforcement*, which is the difference between a degraded system and an outage the CPO cannot fix.

**H-AUDIT.** Writes to a machine-owned file (`knowledge/activity-log.md` or equivalent), never to curated files. It is the evidence base for section 2's promotion rule — you cannot promote a prose rule to a hook "on evidence, not anticipation" without a record of violations, and you cannot graduate a hook from ask to deny (section 4.4's ladder) without a record of its triggers. Keep it append-only, size-capped, and rotated; it is the one file in `knowledge/` the CPO should never read in full.

### 5.4 Roster addition: in scope, and it changes CLAUDE.md

Yes, addition is in scope for H-BOOK, and it should move out of the CPO's hands entirely. Current CLAUDE.md has the CPO add a row on spawn and remove it on report-back. Once H-BOOK-ADD and H-BOOK-REMOVE exist, **that instruction becomes actively harmful**: a CPO still hand-editing the roster would double-write rows and corrupt the counts H-ADMIT depends on.

This is section 2's "prose duplicating a rule a hook already enforces" anti-pattern in its most concrete form. The recommendation is a prose *deletion*, not an addition: CLAUDE.md's roster-maintenance instruction should be replaced with a statement that the roster is maintained automatically and is read-only to the CPO. Route to section 13 as a required edit with user approval, and note in section 12 that it must land in the *same* phase as H-BOOK — shipping the hook while the prose still says "add a row on spawn" is worse than shipping neither.

### 5.5 Progress-memo: the principle is right, the placement is not

The CPO's read is correct on the split — *deciding* what to record is judgment and stays prose per section 4.5 — but the proposed mechanization of the remaining half does not survive contact with how hooks trigger.

**There is no hook event corresponding to "the CPO decided something is worth recording."** Hooks fire at tool boundaries and lifecycle moments; that decision is neither. A hook could only append content that already exists in a tool call's arguments, which means it cannot write a curated memo line — it can only mirror mechanical facts it already has.

So the correction is:

1. **Automatic stream → H-AUDIT, in a separate file.** Structural facts (agent spawned, finished, duration, outcome status, hook triggered) are hook-writable and should go to the machine-owned log from 5.3. Do **not** let a hook append to `progress-memo.md`: mixing machine and curated content in one file muddles authority, makes the Manager's periodic compaction harder, and means the CPO can no longer trust that everything in the memo was something it chose.
2. **Curated stream → stays prose, executed by Manager, standardized by Skill.** The mechanical append-once-decided is already delegable to a Junior Manager. What is currently re-authored by hand is the *format and cadence* of that write, and section 2's step 4 routes recurring-procedure-with-judgment to a Skill, not a hook. Section 7 should own a memo-write Skill; this section should not.

Net: confirm the principle, relocate the automation. The memo stays a human-decided artifact; the log becomes the machine one; nothing writes to both.

### 5.6 The existing SessionStart hook: formalize, with three changes

Keep it — it is already doing real work against G5 — but bring it under this proposal rather than leaving it ad hoc, for three reasons that each imply a change.

1. **Key on the trigger source.** `SessionStart` fires on more than post-compaction resumption. Re-injecting a full roster and memo on every plain startup is context spent for no benefit. The hook should branch on why it fired and inject only where the context was actually lost.
2. **Give it the GC job.** Session start is the natural moment for H-BOOK-GC's sweep and the roster-health flag. Bundling avoids a second hook on the same event.
3. **Cap and summarize what it injects.** Today it re-injects two whole files. As the memo grows this becomes a silent, recurring context tax paid exactly when context is scarcest. Inject the roster in full (it is small and bounded by the caps) but the memo as a capped tail or summary. Once section 9's store exists, this should become a pointer plus a short digest rather than file contents — flag as a section 9 dependency.

**H-BOOT-SNAP** at `PreCompact` is optional and lower priority: it would persist volatile in-flight state before it is compacted away. Recommend deferring it until there is observed loss worth preventing — section 2's promotion rule says mechanize on evidence, and there is none yet.

### 5.7 Failure semantics

Section 4.4's criterion was "can the caller remedy this by changing its next call?" For bookkeeping hooks the question does not arise, because none of them should ever deny. The governing rules:

- **Bookkeeping never blocks.** A failed roster write must not prevent a spawn. Section 4 already owns the one blocking decision on this event.
- **Failure degrades enforcement, not operation.** A bookkeeping failure sets the roster-health flag, which stands H-ADMIT down to audit-only. Wrong counts must never produce confident denials.
- **Failures must be loud.** Silent drift is the characteristic failure of this class — nothing visibly breaks, the roster just quietly stops matching reality. Every failed write emits a non-blocking warning and an H-AUDIT entry.
- **Idempotence.** Both roster writes must tolerate being run twice on the same call key without duplicating or double-deleting, since retries and abnormal sessions will happen.

### 5.8 Dependencies this section creates

1. **H-BOOK ships before H-ADMIT is promoted past audit-only** (section 4.6's ordering, now concrete in both directions).
2. **H-BOOK does not depend on the section 4.1 identity spike** — the paired Pre/Post design sidesteps it. This makes H-BOOK the safest phase-1 candidate in the plan; flag to section 12.
3. **CLAUDE.md prose deletion** (roster maintenance) must land in the same phase as H-BOOK — section 13 for approval.
4. **Reuses the spawn-prompt tag convention** from section 4.3; H-BOOK-ADD and H-ADMIT parse the same line, so it must be specified once, in section 6's spawn Skill.
5. **Memo-write Skill** is now section 7's, not this section's.
6. **H-BOOT's injection payload shrinks** once section 9's store lands — a pointer plus digest instead of file contents.
7. **H-AUDIT's log is the evidence base** for section 12's phasing and section 14's promote/demote criteria; both should assume it exists.

### 5.9 Revision (post-spike correction, 2026-09-21)

A Worker spike investigating section 4.1 found that section 5.2's core assumption does not hold: the `Agent` spawn tool now defaults to background/non-blocking execution, so `PreToolUse`/`PostToolUse` on the same call do **not** reliably bracket the subagent's full lifetime — a backgrounded call's `PostToolUse` fires at dispatch, not completion. `SubagentStop` cannot substitute: it carries a per-instance `agent_id` but not `tool_use_id`, so it can't be joined to the Pre/Post pair, and its own firing reliability is separately reported as inconsistent. This section records the resulting design correction rather than rewriting 5.1–5.3 in place, so the reasoning trail stays visible.

**Direction: reconciliation (the spike's option (c)), not blocking spawns or self-reported correlation.**

- Forcing all roster-tracked spawns into blocking mode (option (a)) was rejected — it trades away the concurrency the caps exist to govern, just to make bookkeeping easier.
- A sidecar keyed on the subagent self-reporting its `agent_id` (option (b)) was rejected as the *primary* mechanism — self-reporting is model-elected/advisory, and section 2's anti-pattern list already forbids a binding gate resting on an advisory signal. It may still exist as an optional fast-path that retires a row early when it happens to fire, but correctness must never depend on it.

**The asymmetry that makes reconciliation cheap.** The spike breaks *removal*, not *addition* — `PreToolUse` on the spawn still fires reliably with everything H-BOOK-ADD needs. So the roster's error is one-directional: it can only over-count, never under-count. Over-counting is the benign direction — it never lets a cap be breached, it only over-blocks spawns that should have been allowed. Section 5.3 survives with two changes:

1. **Removal moves off the hook path entirely.** The genuinely reliable completion signal is the Worker's report landing in the CPO's own context — a model-observed event, not a tool boundary, so per section 2's step 4 it routes to a **Skill** (a report-intake procedure, likely owned by section 6/7, executing retirement through the Manager/KS write path), not to a hook.
2. **H-BOOK-GC becomes the backstop, not the exception handler.** It sweeps on `SessionStart` *and* on every spawn attempt: any row past a generous TTL (hours, not minutes) with no liveness evidence is presumed dead. The Skill is the normal removal path; GC is the safety net, not a fallback for a rare case.

Each roster row gets a TTL column written at add-time, so the sweep needs no external state to evaluate staleness.

**5.1's invariant is relaxed, asymmetrically — not uniformly weakened:**

> Addition is by construction — no agent runs unlisted. Removal is reconciled within N — a finished agent may remain listed for up to N.

**Consequence for section 4:** H-ADMIT must treat the roster as an upper bound, not an exact count. When the only thing blocking a spawn is a row past its expected TTL, H-ADMIT should **ask**, not **deny** — hard deny stays reserved for caps breached by rows that are demonstrably fresh. This keeps every false denial caller-remediable in section 4.4's sense, now that staleness is an expected steady state rather than a failure case. Section 4's hook table and 4.4's failure-semantics table should be read with this amendment when section 4 is revisited.

Section 5.8's dependency list is otherwise unchanged, including that H-BOOK remains independent of the section 4.1 identity spike under this corrected design.
