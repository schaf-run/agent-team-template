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
| toolu_01KZSHTu44oxsSFR7ohdUigf | worker | senior | unspecified | Task (not Feature — the shape is fully prescribed by the spec below, no design d | 2026-09-21T14:06:35Z | 2026-09-21T20:06:35Z |
| toolu_01Kd7wdFaJN6YDmRqRB5kJx2 | worker | senior | unspecified | Task (not Feature — shape is prescribed by the spec below) | 2026-09-21T14:06:50Z | 2026-09-21T20:06:50Z |
| toolu_015EsHZgLVCDAVDQQBCGVPtq | worker | senior | unspecified | Task (not Feature — shape is fully prescribed by the spec below; this is listed | 2026-09-21T14:07:00Z | 2026-09-21T20:07:00Z |
| toolu_01E63mLL1kYHAJpoAd8J6TQY | worker | middle | unspecified | Task | 2026-09-21T14:07:07Z | 2026-09-21T20:07:07Z |
| toolu_019upNf6StaTjv8AuLr7JbmQ | worker | junior | unspecified | Task | 2026-09-21T14:07:13Z | 2026-09-21T20:07:13Z |
| toolu_01PfXkYPLV71myQBbMTbyE81 | worker | senior | unspecified | Task (not Feature — shape is fully prescribed by the spec below) | 2026-09-21T14:07:22Z | 2026-09-21T20:07:22Z |
| toolu_015PtbwiUSTDT2oPzV7bDSAe | worker | middle | unspecified | Task | 2026-09-21T14:07:29Z | 2026-09-21T20:07:29Z |
| toolu_01KmAbzUpzPrQhCLi3taWkKt | worker | middle | unspecified | Repo: /Users/schaf | 2026-09-21T14:16:29Z | 2026-09-21T20:16:29Z |
