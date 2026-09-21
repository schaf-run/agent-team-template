# Active Agents

Live roster of currently running agents. The CPO adds a row when spawning an
agent and removes it once that agent reports back. Used to enforce the
concurrency limits in `CLAUDE.md` — recompute counts from this file before
every spawn decision.

Limits, for reference:
- Per job: max 1 Senior + 1 Middle + 3 Junior Workers active.
- Per area: max 1 Architect active.
- Managers: max 1 active (Junior or Middle) at a time, project-wide.
- Global: max 10 agents active at once (Architects + Managers + Workers).

| Role      | Level  | Job / Area | Task              | Spawned |
|-----------|--------|------------|-------------------|---------|
| Architect | —      | CS/coding — Skills/Hooks/MCP plan | Sections 1–5/14 done (5.9 revision applied), paused for user review before section 6 | 2026-09-21 |
| Worker | Senior | hooks-bookkeeping-automation | Feature: implement H-BOOK/H-AUDIT roster automation (plan §5) — planning only | 2026-09-21 |
