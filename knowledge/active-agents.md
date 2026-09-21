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

| call_key | role | level | job/area | task | start_time | ttl_expiry |
|---|---|---|---|---|---|---|
