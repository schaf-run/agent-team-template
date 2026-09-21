#!/bin/bash
# Roster bookkeeping for knowledge/active-agents.md, per
# knowledge/docs/skills-hooks-mcp-plan.md section 5 (corrected by 5.9).
#
# Subcommands:
#   add     - PreToolUse hook body for the Agent spawn tool (H-BOOK-ADD).
#             Reads the hook JSON payload on stdin. Runs a GC sweep first
#             (this is how "GC on every spawn attempt" is implemented,
#             folded into this script rather than a second hook).
#   gc      - H-BOOK-GC sweep: deletes any roster row whose ttl_expiry has
#             passed. Safe to call standalone (SessionStart) or from add.
#   retire  - Roster removal, called by the roster-retire Skill with a
#             call_key. Deletes the matching row and logs its duration.
#
# NOTE: this script is not yet wired into .claude/settings.json. Wiring it
# requires editing that config file, which is being held pending direct
# user confirmation (see Worker report).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable for testing against scratch copies without touching the
# real knowledge/ files.
ROSTER="${ROSTER_FILE:-$DIR/knowledge/active-agents.md}"
AUDIT="${AUDIT_FILE:-$DIR/knowledge/activity-log.md}"
HEALTH="${ROSTER_HEALTH_FILE:-$DIR/knowledge/.roster-health}"
TTL_HOURS="${ROSTER_TTL_HOURS:-6}"
# H-AUDIT log size cap (5.3: "append-only, size-capped, rotated"). Simple
# truncate-to-tail rotation, not archival - see roster.sh header/report.
AUDIT_MAX_LINES="${AUDIT_MAX_LINES:-1000}"
AUDIT_KEEP_LINES="${AUDIT_KEEP_LINES:-500}"

HEADER_L1="| call_key | role | level | job/area | task | start_time | ttl_expiry |"
HEADER_L2="|---|---|---|---|---|---|---|"
# Legacy hand-maintained table (pre-call_key). Nothing should write new
# rows here going forward; gc() treats any data row found under it as
# automatically orphaned. Matched loosely (whitespace-tolerant) since it
# predates this script and was never a machine-owned format.
LEGACY_HEADER_RE='^\| *Role *\| *Level *\| *Job */ *Area *\| *Task *\| *Spawned *\|$'
SEPARATOR_RE='^\|[-|[:space:]]*\|$'

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
now_epoch() { date -u +%s; }
to_epoch() {
  # Portable-ish ISO8601 -> epoch (BSD date on macOS, GNU date fallback).
  date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null || date -u -d "$1" +%s
}
plus_hours_iso() {
  local h="$1"
  date -u -v+"${h}"H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+${h} hours" +"%Y-%m-%dT%H:%M:%SZ"
}

audit() { # event call_key role_level job_area detail
  mkdir -p "$(dirname "$AUDIT")"
  touch "$AUDIT"
  printf '%s | %s | %s | %s | %s | %s\n' "$(now_iso)" "$1" "$2" "$3" "$4" "$5" >> "$AUDIT"
  rotate_audit
}

# H-AUDIT: "append-only, size-capped, rotated". Truncate-to-tail once the
# log passes AUDIT_MAX_LINES, keeping the most recent AUDIT_KEEP_LINES.
# Not a real archival rotation scheme (no archive file) - flagged as such
# in the worker report; this is the minimal enforcement the plan asked for.
rotate_audit() {
  local lines
  lines=$(wc -l < "$AUDIT" 2>/dev/null | tr -d ' ')
  [ -z "$lines" ] && return 0
  if [ "$lines" -gt "$AUDIT_MAX_LINES" ]; then
    local tmp
    tmp=$(mktemp)
    tail -n "$AUDIT_KEEP_LINES" "$AUDIT" > "$tmp"
    mv "$tmp" "$AUDIT"
  fi
}

# gc/retire never rebuild the file wholesale. They stream it line by line,
# passing everything through untouched (prose, legacy table, blank lines)
# until they see the exact H-BOOK-ADD header pair (HEADER_L1 immediately
# followed by HEADER_L2); only pipe-prefixed lines *after* that pair are
# treated as H-BOOK data rows, until a non-pipe line ends the table.
ensure_roster() {
  if [ ! -f "$ROSTER" ]; then
    printf '%s\n%s\n' "$HEADER_L1" "$HEADER_L2" > "$ROSTER"
  elif ! grep -qF "$HEADER_L1" "$ROSTER" 2>/dev/null; then
    # First-time migration: append the new table (header + blank line)
    # to the end of the existing file rather than rewriting anything.
    printf '\n%s\n%s\n' "$HEADER_L1" "$HEADER_L2" >> "$ROSTER"
  fi
}

gc() {
  ensure_roster
  local now tmp state swept
  now=$(now_epoch)
  tmp=$(mktemp)
  : > "$tmp"
  state="seek"
  swept=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$state" in
      seek)
        printf '%s\n' "$line" >> "$tmp"
        if [ "$line" = "$HEADER_L1" ]; then
          state="header1"
        elif [[ "$line" =~ $LEGACY_HEADER_RE ]]; then
          state="legacy_header1"
        fi
        ;;
      header1)
        printf '%s\n' "$line" >> "$tmp"
        if [ "$line" = "$HEADER_L2" ]; then state="table"; else state="seek"; fi
        ;;
      legacy_header1)
        printf '%s\n' "$line" >> "$tmp"
        if [[ "$line" =~ $SEPARATOR_RE ]]; then state="legacy_table"; else state="seek"; fi
        ;;
      table)
        case "$line" in
          \|*)
            IFS='|' read -r _ ck role level jobarea task start ttl _ <<< "$line"
            ttl_trimmed="$(echo "$ttl" | xargs)"
            ttl_epoch=$(to_epoch "$ttl_trimmed" 2>/dev/null || echo 0)
            if [ -n "$ttl_trimmed" ] && [ "$ttl_epoch" -gt 0 ] && [ "$now" -gt "$ttl_epoch" ]; then
              audit "gc-purge" "$(echo "$ck" | xargs)" "$(echo "$role" | xargs)/$(echo "$level" | xargs)" "$(echo "$jobarea" | xargs)" "past TTL $ttl_trimmed"
              swept=1
            else
              printf '%s\n' "$line" >> "$tmp"
            fi
            ;;
          *)
            printf '%s\n' "$line" >> "$tmp"
            state="seek"
            ;;
        esac
        ;;
      legacy_table)
        case "$line" in
          \|*)
            # Any data row still in the legacy table is, by design,
            # automatically orphaned - nothing legitimate writes here
            # anymore. Unconditionally sweep it, no TTL involved.
            IFS='|' read -r _ role level jobarea task spawned _ <<< "$line"
            audit "gc-purge-legacy" "-" "$(echo "$role" | xargs)/$(echo "$level" | xargs)" "$(echo "$jobarea" | xargs)" "legacy-format row (spawned $(echo "$spawned" | xargs))"
            swept=1
            ;;
          *)
            printf '%s\n' "$line" >> "$tmp"
            state="seek"
            ;;
        esac
        ;;
    esac
  done < "$ROSTER"
  mv "$tmp" "$ROSTER"
  set_health "$swept"
}

# Roster-health flag (5.3/5.6/5.9): recomputed on every sweep, not sticky
# across sweeps - a clean sweep clears it, an orphan-finding sweep sets it.
# H-ADMIT (the CPO's own spawn-cap read of active-agents.md, per CLAUDE.md)
# should treat a "degraded" flag as a signal to ask rather than hard-deny
# when a stale-looking row is the only thing blocking a spawn.
set_health() {
  local swept="$1" prev new
  prev="ok"
  [ -f "$HEALTH" ] && prev="$(cat "$HEALTH" 2>/dev/null | xargs)"
  [ -z "$prev" ] && prev="ok"
  if [ "$swept" -eq 1 ]; then new="degraded"; else new="ok"; fi
  if [ "$new" != "$prev" ]; then
    audit "roster-health" "-" "-" "-" "flag $prev -> $new"
  fi
  mkdir -p "$(dirname "$HEALTH")"
  printf '%s\n' "$new" > "$HEALTH"
}

add() {
  gc
  local payload subagent_type prompt role level jobarea task tool_use_id start ttl
  payload="$(cat)"
  tool_use_id="$(echo "$payload" | jq -r '.tool_use_id // "unknown"')"
  subagent_type="$(echo "$payload" | jq -r '.tool_input.subagent_type // "unknown"')"
  prompt="$(echo "$payload" | jq -r '.tool_input.prompt // ""')"

  case "$subagent_type" in
    worker-*) role="worker"; level="${subagent_type#worker-}" ;;
    manager-*) role="manager"; level="${subagent_type#manager-}" ;;
    architect) role="architect"; level="-" ;;
    *) role="$subagent_type"; level="-" ;;
  esac

  # Best-effort job/area extraction from a structured tag line in the
  # prompt (section 4.3's tag format). Looks for "Job/Area:", "Job:" or
  # "Area:" (case-sensitive to that exact convention), takes the text up
  # to the next sentence-ending punctuation. Falls back to "unspecified"
  # until section 4 fixes the exact tag syntax.
  jobarea="$(printf '%s' "$prompt" | awk '
    {
      if (match($0, /(Job\/Area|Job|Area)[ \t]*:[ \t]*/)) {
        rest = substr($0, RSTART + RLENGTH)
        sub(/[.;,\n].*/, "", rest)
        print rest
        exit
      }
    }' | xargs || true)"
  [ -z "$jobarea" ] && jobarea="unspecified"

  task="$(echo "$prompt" | sed -n '1s/\([^.]*\)\..*/\1/p' | cut -c1-80 | xargs)"
  [ -z "$task" ] && task="(no summary)"

  start="$(now_iso)"
  ttl="$(plus_hours_iso "$TTL_HOURS")"

  ensure_roster
  printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
    "$tool_use_id" "$role" "$level" "$jobarea" "$task" "$start" "$ttl" >> "$ROSTER"

  audit "spawn" "$tool_use_id" "$role/$level" "$jobarea" "$task"
}

retire() {
  local call_key="$1"
  ensure_roster
  local tmp found state
  tmp=$(mktemp)
  found=0
  : > "$tmp"
  state="seek"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$state" in
      seek)
        printf '%s\n' "$line" >> "$tmp"
        [ "$line" = "$HEADER_L1" ] && state="header1"
        ;;
      header1)
        printf '%s\n' "$line" >> "$tmp"
        if [ "$line" = "$HEADER_L2" ]; then state="table"; else state="seek"; fi
        ;;
      table)
        case "$line" in
          \|*)
            IFS='|' read -r _ ck role level jobarea task start ttl _ <<< "$line"
            ck_trimmed="$(echo "$ck" | xargs)"
            if [ "$ck_trimmed" = "$call_key" ]; then
              found=1
              start_trimmed="$(echo "$start" | xargs)"
              start_epoch=$(to_epoch "$start_trimmed" 2>/dev/null || echo 0)
              now=$(now_epoch)
              dur="n/a"
              [ "$start_epoch" -gt 0 ] && dur="$(( (now - start_epoch) / 60 ))m"
              audit "retire" "$call_key" "$(echo "$role" | xargs)/$(echo "$level" | xargs)" "$(echo "$jobarea" | xargs)" "duration=$dur"
            else
              printf '%s\n' "$line" >> "$tmp"
            fi
            ;;
          *)
            printf '%s\n' "$line" >> "$tmp"
            state="seek"
            ;;
        esac
        ;;
    esac
  done < "$ROSTER"
  mv "$tmp" "$ROSTER"
  [ "$found" -eq 1 ]
}

cmd="${1:-}"
shift || true
case "$cmd" in
  add) add ;;
  gc) gc ;;
  retire) retire "$@" ;;
  *) echo "usage: roster.sh {add|gc|retire <call_key>}" >&2; exit 1 ;;
esac
