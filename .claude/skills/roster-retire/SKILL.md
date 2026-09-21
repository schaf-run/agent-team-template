---
name: roster-retire
description: Retire a completed agent's row from knowledge/active-agents.md. Invoke this right after a spawned agent's (Architect/Manager/Worker) final report lands in your context — the report landing is the completion signal, not any tool event. Needs the tool_use_id of the Agent spawn call whose report just arrived.
---

# Roster retire

`knowledge/active-agents.md` is kept accurate by construction: `H-BOOK-ADD`
(a `PreToolUse` hook on the `Agent` tool) appends a row the instant a spawn
is issued, and `H-BOOK-GC` sweeps anything left over its TTL as a backstop.
Neither of those hooks can reliably detect *completion* — the `Agent` tool
can run non-blocking, so there is no tool-boundary event that fires when a
subagent is actually done. The only reliable completion signal is a
model-observed one: **the spawned agent's report showing up in your (the
CPO's) own context.**

This Skill is that missing removal step. It is a thin wrapper around
`scripts/roster.sh retire`, which does the real work of finding and
deleting the matching row and logging its duration to
`knowledge/activity-log.md`.

## When to invoke

Invoke this immediately after you finish reading a spawned agent's final
report — Architect, Manager, or Worker of any level — and before you act
on that report further. One invocation per completed spawn. Do not invoke
speculatively, and do not invoke for a `Feature`-mode Senior Worker's plan
report that you're about to resume (that instance is still active — only
retire it once its *final* report lands and you are not resuming it
again).

## What it does

Run:

```
bash scripts/roster.sh retire <tool_use_id>
```

where `<tool_use_id>` is the `id` of the `Agent` tool_use block for the
spawn call whose report you just received — you already have this value
from when you issued that spawn (or can find it by matching the spawn
call adjacent to the report in the transcript). This is the same value
`H-BOOK-ADD` used as the row's `call_key` when it appended the row, so the
match is exact.

The command deletes the matching row from `knowledge/active-agents.md` and
appends a `retire` line (with computed duration) to
`knowledge/activity-log.md`. It is idempotent: if the row was already
removed (e.g. `H-BOOK-GC` swept it first for being past its TTL), the
command simply finds nothing to delete — do not treat that as an error or
retry loop.

## What it is not

This Skill does not decide *whether* a report is worth recording in
`knowledge/progress-memo.md` — that stays your judgment call, exactly as
before. It only removes the bookkeeping row for a spawn that has finished.
Never hand-edit `knowledge/active-agents.md` directly to remove a row;
always go through `scripts/roster.sh retire` so the audit log stays
correct.
