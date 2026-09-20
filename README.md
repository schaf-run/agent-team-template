# Architect / Manager / Worker Project Template

A reusable Claude Code project template built around a three-role agent
hierarchy instead of one flat coding assistant.

## The roles

- **Manager** (`CLAUDE.md`) — the main agent, the one you talk to. Sonnet by
  default. Orchestrates only: turns the Architect's plans into concrete
  Worker tasks, distributes them, tracks progress in `knowledge/`. Never
  writes code, calls APIs, or searches itself.
- **Architect** (`.claude/agents/architect.md`) — big-picture planning and
  structural decisions only. Opus by default, the only role allowed to run
  in Fable mode. Read-only (no execution) — the Manager feeds it everything
  it needs to reason about.
- **Worker** (`.claude/agents/worker-{junior,middle,senior}.md`) — the role
  that actually does things (code, research, whatever the task calls for),
  at three levels of capability/model:
  - `worker-junior` (Haiku) — small, mechanical tasks.
  - `worker-middle` (Sonnet) — real authoring, basic debugging.
  - `worker-senior` (Sonnet, Opus with Manager approval) — novel work, code
    review, web research, harder debugging. Plans before executing and can
    propose delegating part of a task down to a lower level.

See `CLAUDE.md` for the full workflow, escalation rules, delegation policy,
and concurrency limits the Manager follows (at most 1 Senior + 1 Middle + 3
Junior Workers per job, 1 Architect per area, 10 agents active at once,
globally).

## Knowledge directory

`knowledge/` is a placeholder persistent store (guidelines, a progress
memo, a live active-agents roster, and a docs folder for Architect plans)
that the Manager reads and writes. It's plain markdown files for now so the template works out of the
box; swap it for an MCP-backed knowledge tool per-project without changing
the workflow — the Manager's read/write interface to it stays the same.

## Using this template

1. Copy this directory into a new project (or use it as a starting point
   however you normally bootstrap projects).
2. Open it in Claude Code — the Manager persona in `CLAUDE.md` is what you
   talk to by default.
3. Fill in `knowledge/guidelines.md` with any project-specific conventions
   as they come up.
4. If a project needs a real knowledge-store MCP server, wire it up and
   update the "Knowledge directory" section of `CLAUDE.md` to point at it
   instead of the local files.
