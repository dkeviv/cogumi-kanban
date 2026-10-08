# Cogumi Claude Kanban — requirements coverage (PRD v2.1)

Each requirement maps to where it is implemented and which tests verify it. Test names are abbreviated; files are under `plugin/tests/`. "Engine" means `plugin/src/engine/engine.ts` (reused from the ChatGPT edition with its original test suites: `engine`, `completeness`, `bug-fixes`, `review-regressions`, `source-coverage`, `source-import`, `board-view`).

Status: **Covered** = implemented and tested. **Verified manually** = exercised by hand, as noted. **Open** = depends on behaviour this repository cannot test.

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| State model | Engine `update_status`, `invalidate`; Blocked resumes to its prior state under that state's gates, or Backlog ends the attempt | engine; review-regressions; coverage "closed rework…", "a Blocked story resumes…" | Covered |
| SEC 01 stdio only, owner-only files | `server/mcp.ts`; `store.ts openStore`; umask in server, CLI, hook, scripts | store "owner-only…WAL"; mcp "bundled stdio"; coverage "owner-only under a permissive umask" | Covered |
| SEC 01 owner and scoped reporter actors | `identity.ts`; `reporter.ts deliverAsReporter`; engine reporter allowlist | workflow "scenario 9"; store "refuses owner actions" | Covered |
| SEC 01 board manifest and redacted reads | `commands/board.md`; `views.ts` | plugin "manifest names exactly…"; views; board-page "redacted cards" | Covered; host consent behaviour Open |
| SEC 01 credential handling | `checkpoints.ts` key/value patterns; `service.call` redacts writes; views redact reads; scripts redact at enqueue | workflow "scenario 19"; review-fixes "credentials … redacted" | Covered |
| DAT 01 data root, SQLite, CAS retry, WAL, audit, adapters | `store.ts`, `service.ts`, `persistence.ts`, `identity.ts` | store (two-service and three-process claim races, schema guard, legacy migration) | Covered |
| BKL 01 import with preview, reimport, revisions | Engine `preview_import`, `import_stories` | coverage "preview_import writes nothing"; source-coverage "Abovely seed repeats" | Covered |
| BKL 02 proof plans, waivers, Ready gate, cycles | Engine proof schema, `waive_criterion`, dependency graph | review-regressions; engine "dependency gate" | Covered |
| UI 01 live board, refresh, stale and disconnected states, filters | `board/kanban-board.html` (watchTool, retract, Refresh) | board-page "live board…", "disconnects retract…", "outside Claude"; views denominators | Covered (jsdom with stubbed capability); live host bridge Open |
| UI 01 snapshot fallback | `snapshot.ts`, `cli snapshot` | hook-snapshot (2); board-page "snapshot mode" | Covered |
| UI 02 proof detail | `views.ts storyDetail`; board `renderStory` | views "story_detail"; board-page "rework from the board" | Covered |
| WRK 01 next story, atomic claim, lease, stale claims | Engine `next_story`, `claim_story`, `recover_claim` | engine; store claim races; review-regressions | Covered |
| WRK 02 instructions in four channels, read-only annotations | `mcp.ts instructions`; `skills/`; `commands/`; `hook/` | mcp "initialize…", "tools/list…"; plugin; hook-snapshot | Covered; loaded in a real Claude Code session (verified manually) |
| TST 01 wrapper evidence, crash/signal, mocked, artifacts | `scripts/test-and-report.mjs` | workflow B07, signal, timeout; scripts B11/B17; coverage "https artifact" | Covered |
| TST 02 proof appropriate to criterion | Engine strict checks, named assertions, labels | completeness; bug-fixes assertions | Covered (what a tracker can enforce) |
| SHP 01 release gates, source change invalidates | Engine `eligibility`, `set_commit` | engine "changed source…"; review-regressions B05/B09 | Covered |
| SHP 02 provider release, failed deploy, deployed checks | `scripts/workflow.mjs release`; engine `record_release` | coverage "failed and successful releases…" | Covered |
| REL 01 outbox, retries, idempotency, quarantine, settle/requeue/discard, heartbeat warning | `scripts/reporting.mjs`, `checkpoint.mjs`, `workflow.mjs` | workflow scenarios 5/20/21; review-fixes (rejected → blocked, wrong data root, requeue); review-2 (settled rejections, discard, deterministic resolution); recovery locks; scripts B10 | Covered |
| REL 02 resume and interruption | `checkpoint.mjs resume`; engine `start_session` | workflow "killed wrapper…", "registered before journal crash", "durable snapshot…"; coverage "start_session … known releases" | Covered |
| REC 01 checkpoint reconciliation, repairs, conflicts | Engine `reconcile`, `checkpoint_attempt`; `workflow before-close` | coverage "reconcile records repairs and conflicts"; review-fixes "before-close exits 3"; completeness | Covered |
| REC 02 periodic detection | Not implemented | — | Next stage by PRD |
| PRJ 01 binding, worktrees, sessions | `binding.ts`; engine `resolve_project`, `add_binding`, `associate_thread`; hook | binding (normalization, worktrees); review-fixes edge cases; completeness | Covered |
| INT 01 informal intake | Engine `propose_intake`, `decide_intake` | completeness; bug-fixes | Covered |
| COV 01 coverage, exclusions, display | Engine `set_requirements`, `exclude_requirement`, `exclude_story` (reason required; revised phase scope recorded with `approve_scope`, per PRD v2.1); `views.ts coverage`; board list | coverage "excluded requirement…"; source-coverage | Covered |
| EPC 01 phase completion | Engine `summary` | source-coverage; views; review-regressions | Covered |
| OSP 01 OpenSpec | `scripts/openspec-*.mjs` (`kanban openspec`); engine `import_source_bundle` | source-import; source-coverage | Covered |
| REW 01 rework from board or chat | Engine `request_rework`, `classify_rework`; board form | views "scenario 15"; coverage "closed rework…"; board-page "rework from the board" | Covered |
| REW 02 corrective verification | Engine `record_reproduction`, generation bump | coverage "closed rework…"; bug-fixes reproduction | Covered |
| PLG 01 plugin packaging, bundled runtime, launcher | `.claude-plugin/`, `.mcp.json`, `hooks/`, `bin/`, `build.mjs` | plugin (manifests, dist current, launcher); coverage "launcher discovers nvm"; install (isolated marketplace install) | Covered |
| PLG 02 board publication | `commands/board.md`, board template | plugin "manifest names exactly…" | Covered statically; host reachability Open |
| MIG 01 ChatGPT import | `migrate.ts`, `cli import` | migrate (5); review-fixes import validation | Covered |

End-to-end: e2e-strict "strict project goes from creation to Shipped by following the skill…" walks the documented workflow through `bin/kanban` on a strict project.

## Acceptance scenarios

| # | Tests |
|---|---|
| 1 | source-coverage "Abovely seed repeats"; review-regressions B12 |
| 2 | store "two services…", "two separate processes…" |
| 3 | engine "missing partial mocked…", "shipping requires…" |
| 4 | engine "changed source invalidates…" |
| 5 | workflow "database outage replay…" |
| 6 | review-regressions B02/B05 |
| 7 | workflow "killed wrapper…" |
| 8 | coverage "failed and successful releases…" |
| 9 | workflow "reporter scoped to one attempt…"; store "refuses owner actions" |
| 10 | board-page "live board…", "disconnects retract…" |
| 11 | completeness add_binding/thread; binding worktrees |
| 12 | completeness intake |
| 13 | source-coverage bundle; source-import |
| 14 | views; source-coverage |
| 15 | coverage "closed rework…"; board-page "rework from the board"; review-regressions B01 |
| 16 | install "plugin installs from its marketplace into a clean configuration…" (validate, marketplace add, install, details, installed server and hook start); plugin static checks; manual: headless Claude session calling the tools |
| 17 | migrate "import strips derived fields…", CLI round-trip |
| 18 | workflow "scenario 18" |
| 19 | workflow "scenario 19" |
| 20 | workflow "scenario 20"; review-fixes "rejected result…"; coverage "strict claims require a fresh session with no pending or rejected events" |
| 21 | workflow "scenario 21" |
| 22 | binding (normalization, worktrees) |

## Open items (cannot be tested in this repository)

- That the Claude desktop app exposes a plugin-provided MCP server as an Artifact `host:` server, and its consent prompts. The page logic is tested against a stub that follows the published capability contract. A fallback is documented in the README.
- Periodic stale detection (REC 02) is Next-stage scope.
