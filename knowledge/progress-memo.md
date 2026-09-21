# Progress Memo

Running log the CPO updates as work completes. Newest entries at the
top. Each entry: date, what was done, which agent(s) did it, and anything
notable for future reference.

## 2026-09-21 — Phase 1 status audit (3d-model-viewer-plan.md)

Senior Worker (Task) audited real code state against the Phase 1 task
breakdown (`knowledge/docs/3d-model-viewer-plan.md` §6), reading code and
running builds/tests rather than trusting file presence. Everything that
exists is clean: `cargo build/test/clippy --workspace` all green (10/10
tests), `npm run build/test/lint` all green (23/23 tests).

- **J0 (Contract & Scaffolding): DONE.** All 4 backend crates scaffolded,
  contract/openapi.yaml + types.ts + fixtures, frontend Vite/React/TS
  scaffold, all 9 `fixtures/small/` files, guidelines.md updated. B0-2's
  dependency/memory spike ran and reported (pinned `tobj` 4.0.5, no
  RSS-failure caveat) — confirms B1-7 (contingency parser) is correctly
  NOT triggered.
- **J1 (Backend Core & Storage): 2/7.** B1-1 (domain types/traits) and
  B1-2 (ULID/CSPRNG slug) done. B1-3 (`FsBlobStore`), B1-4 (SQLite
  migrations), B1-5 (`SqliteMetadataStore`), B1-6 (GC sweeper) all
  **not started** — `model-storage` crate is still a one-line stub.
- **J2 (Transcode Pipeline): 0/11.** `model-transcode` crate is a stub;
  none of B2-1..B2-11 exist yet.
- **J3 (Frontend Shell & Upload): 2/10.** F3-1 (`api/client.ts`) and
  F3-8 (generic components) done. Everything upload-flow-specific
  (validateObj, chunkedUploader, DropZone, UploadProgress, ShareLinkPanel,
  UploadPage) **not started** — `HomePage.tsx` is an explicit placeholder.
- **J4 (Frontend Viewer): 1/13.** Only F4-1 (`createGltfLoader.ts`) done.
  `ViewerPage.tsx` is an explicit placeholder; nothing else in the LOD/
  viewer pipeline exists.

Net: J0 fully unblocks Phase 1 as designed; the four Phase-1 jobs are
unevenly started (J1/J3/J4 have a toehold, J2 hasn't begun at all) with
no failures anywhere in what does exist.

## 2026-09-21 — Hooks implementation audit + fixes (plan section 5)

Audited the H-BOOK/H-BOOT implementation (from the prior
hooks-bookkeeping-automation Senior Worker task) against
`knowledge/docs/skills-hooks-mcp-plan.md` section 5, via a Senior Worker
(Task). Result: H-BOOK-ADD, the roster-retire Skill, H-AUDIT, H-BOOT-INJECT,
and the CLAUDE.md 5.4 prose swap all work correctly. Two real gaps found:
(1) two pre-existing legacy-format rows in `active-agents.md` were
structurally unreachable by both retire and GC (parser only recognized the
new `call_key` table) — permanently orphaned, not just pending; (2) GC
never set the section 5.3/5.6 "roster-health flag" on finding orphans.

Fixed via two parallel spawns: a Junior Manager deleted the two orphaned
legacy rows (one-time cleanup, exact content specified by the CPO); a
Middle Worker patched `scripts/roster.sh` — added a `knowledge/.roster-health`
marker set by `gc()` (degraded/ok, recomputed each run, transition-logged
only), made GC treat any row under the old table's header as automatically
orphaned/sweepable so this class of bug can't recur, and added basic
activity-log rotation (truncate to last 500 lines past 1000 — flagged as
minimal enforcement, not a full archival scheme). All changes tested
against scratch files, never touching real `knowledge/` files directly.
Remaining known cosmetic issue: `scripts/roster.sh`'s header comment still
says "not yet wired" — stale, harmless, left as-is.

Files changed: `scripts/roster.sh` (Worker), `knowledge/active-agents.md`
(Manager, row deletion only). Both spawned agents' roster rows retired via
the `roster-retire` Skill immediately after their reports landed.

## 2026-09-21 — Task vs Feature protocol for Senior Worker spawns

Designed and implemented a Task/Feature labeling scheme for Senior Worker
spawns, extending the existing Architect Question/Plan protocol pattern
down to Workers. Done via one Architect instance (Question, then a
follow-up correction on the same instance) after the user redirected the
first draft: Feature does NOT route to the Architect — it only tells the
Senior Worker to plan first and report the plan back before executing,
with the CPO resuming the same Worker instance to authorize execution
(mirroring Architect Plan instance reuse). Full record in
`knowledge/docs/task-feature-protocol.md`. Changed: `CLAUDE.md`
("Working with Workers" section), `.claude/agents/worker-senior.md`.

Also cleaned a stale `active-agents.md` roster row (an Architect entry
left over from a prior session with no live agent behind it — confirmed
via `ListAgents` before removing).
