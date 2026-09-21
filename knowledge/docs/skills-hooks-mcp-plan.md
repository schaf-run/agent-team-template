# Plan: Incorporating Skills, Hooks, and MCP into the 4-role system

Architect-authored, assembled section-by-section by the CPO as each section
call completes. Skeleton (14 sections) approved 2026-09-21.

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
