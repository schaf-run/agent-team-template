#!/bin/bash
# SessionStart hook body, formalized per skills-hooks-mcp-plan.md 5.6.
# Always runs the roster GC sweep (H-BOOK-GC), regardless of why the
# session started. Only re-injects roster + memo content when the trigger
# source indicates context may actually have been lost (compact/resume) -
# a plain fresh startup skips the injection entirely.
#
# NOTE: not yet wired into .claude/settings.json - see scripts/roster.sh
# header for why.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT="$(cat)"
SOURCE="$(echo "$INPUT" | jq -r '.source // "startup"')"

# H-BOOK-GC: always, regardless of source.
bash "$DIR/scripts/roster.sh" gc >/dev/null 2>&1 || true

case "$SOURCE" in
  compact|resume)
    ACTIVE_AGENTS=$(cat "$DIR/knowledge/active-agents.md" 2>/dev/null || echo "(knowledge/active-agents.md not found)")
    PROGRESS_MEMO_TAIL=$(tail -n 20 "$DIR/knowledge/progress-memo.md" 2>/dev/null || echo "(knowledge/progress-memo.md not found)")
    jq -n \
      --arg source "$SOURCE" \
      --arg agents "$ACTIVE_AGENTS" \
      --arg memo "$PROGRESS_MEMO_TAIL" \
      '{
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: ("# Reinjected state (source: " + $source + ")\n\n## knowledge/active-agents.md\n" + $agents + "\n\n## knowledge/progress-memo.md (tail)\n" + $memo)
        }
      }'
    ;;
  *)
    exit 0
    ;;
esac
