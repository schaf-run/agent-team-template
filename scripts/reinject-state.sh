#!/bin/bash
# SessionStart hook (matcher: compact). Re-injects the Manager's live state
# files back into context right after a compaction (manual /compact or
# automatic), since the Manager relies on them to track running agents and
# progress across a session that may just have lost earlier context.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ACTIVE_AGENTS=$(cat "$DIR/knowledge/active-agents.md" 2>/dev/null || echo "(knowledge/active-agents.md not found)")
PROGRESS_MEMO=$(cat "$DIR/knowledge/progress-memo.md" 2>/dev/null || echo "(knowledge/progress-memo.md not found)")

jq -n \
  --arg agents "$ACTIVE_AGENTS" \
  --arg memo "$PROGRESS_MEMO" \
  '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ("# Reinjected state after compaction\n\nA compaction just happened. Here is the current knowledge/ state so you don'"'"'t lose track of active agents or progress:\n\n## knowledge/active-agents.md\n" + $agents + "\n\n## knowledge/progress-memo.md\n" + $memo)
    }
  }'
