# Task vs Feature protocol for Senior Worker spawns

Decision record. Architect answered as two linked Questions (2026-09-21);
implemented same day in `CLAUDE.md` and `.claude/agents/worker-senior.md`.

## Problem

The Architect/CPO relationship already has a Question/Plan protocol: a
Question is a narrow decision answered directly; a Plan is a big
multi-part task built via a skeleton call plus section calls on one
reused Architect instance. The CPO wanted an analogous mechanism for
Senior Worker spawns, since today a Senior Worker always plans before
executing, even for small, obvious asks.

## Decision

Task vs Feature is a label the CPO puts on every **Senior Worker** spawn.
It is independent of the Architect: it does not change whether the CPO
briefs the Architect for a big-picture Plan (that decision is unchanged),
and it does not route "Feature" work to the Architect. It only controls
whether the Senior Worker plans before executing.

- **Feature** — label when the shape of the solution isn't obvious, the
  work spans multiple components or will branch as it's discovered, or
  the CPO wants to see the approach before code exists. Behavior: level-fit
  check, then the Worker plans and reports the plan back *without
  executing* (its own "skeleton call"). The CPO resumes the same Worker
  instance via `SendMessage` to authorize execution or ask follow-ups,
  rather than spawning fresh — mirroring the Architect's "reuse one
  instance across a Plan" rule. No label on a spawn defaults to Feature.
- **Task** — label for everything else: a self-contained ask with an
  obvious shape. Behavior: level-fit check only (no written plan), then
  execute directly if it fits Senior level.
- Both labels keep the existing safety net: if the Worker judges the work
  actually belongs at Junior/Middle, it stops and reports a downgrade
  recommendation instead of executing, and the CPO decides whether to
  spawn the lower-level Worker itself.
- Escape hatch on `Task`: if the work turns out bigger/more branching than
  the spec implied mid-execution, the Worker stops and reports that it
  should be re-issued as a `Feature` instead of silently expanding scope.

## Where implemented

- `CLAUDE.md`: new "Task vs Feature (Senior Worker spawns)" subsection
  under "Working with Workers"; rewritten "Senior Worker delegation flow"
  describing both label behaviors and the instance-reuse instruction; a
  note in "Context & token management" that a Feature plan report is
  still a capped Worker report, not an Architect Plan document.
- `.claude/agents/worker-senior.md`: "Plan before you execute" replaced
  with "Task vs Feature mode" implementing the above; description line
  updated to summarize the two modes.

Junior/Middle Workers and the Architect's own Question/Plan protocol are
unaffected.
