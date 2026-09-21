# Activity Log (H-AUDIT)

Machine-owned, append-only event log. Written by `scripts/roster.sh`
(spawn / gc-purge / retire events) and, once wired, by the
`roster-retire` Skill. Not for hand-editing; not meant to be read in
full by the CPO — size-capped/rotated per skills-hooks-mcp-plan.md 5.3.

Format: `timestamp | event | call_key | role/level | job/area | detail`

---
2026-09-21T12:53:37Z | spawn | toolu_014wgYojctJMGt2QTMY75ygq | worker/senior | unspecified | Task: Audit an in-progress implementation against a design spec and report exact
2026-09-21T12:57:34Z | retire | toolu_014wgYojctJMGt2QTMY75ygq | worker/senior | unspecified | duration=3m
2026-09-21T12:59:27Z | spawn | toolu_01YTh4j3TMb7szcu939ZvT7Z | manager/junior | unspecified | Edit `knowledge/active-agents
2026-09-21T12:59:45Z | spawn | toolu_017PQquhrxSkyMWUhkr26ko9 | worker/middle | unspecified | Task (bug fix, scope is bounded and already diagnosed — no design work needed):
2026-09-21T13:00:59Z | retire | toolu_01YTh4j3TMb7szcu939ZvT7Z | manager/junior | unspecified | duration=1m
2026-09-21T13:03:08Z | retire | toolu_017PQquhrxSkyMWUhkr26ko9 | worker/middle | unspecified | duration=3m
