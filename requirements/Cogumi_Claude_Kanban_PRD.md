# Historical PRD v2.1

The consolidated specification is [Cogumi Kanban PRD v3.0](Cogumi_Kanban_PRD.md). This historical version is retained below for provenance.

# Cogumi Claude Kanban — Product Requirements

Version 2.1 | October 7 2026 | Owner Vivek | Aligned with the Claude local-database plan; updated after code and coverage reviews
Derived from: Cogumi Kanban PRD v1.1 (ChatGPT Sites edition), source commit 7f33b02

Cogumi Claude Kanban is a private visual development tracker that ships as a Claude Code plugin. Claude Code updates it while implementing, testing and releasing approved work. All records live in a local SQLite database on the owner's machine; the Kanban board is a Claude Artifact that reads the plugin's local MCP server live. It tracks any number of projects through a reusable project model. This PRD describes the intended product, functional acceptance criteria and verified evidence requirements; it does not initiate development or an autonomous worker.

## Goal and promise

Goal: Make autonomous development progress visible and trustworthy at story and epic level, with functional proof attached to every completion claim.

Promise: See what Claude is working on, what passed, what is blocked and what was shipped, without manually maintaining a board. Missed reporting is recoverable and incomplete evidence cannot silently become a shipped card.

The tracker does not guarantee bug free software or uninterrupted execution. It records and enforces process evidence; tests, review and deployed verification establish bounded confidence in behavior.

## Users and scope

Owner: Vivek, the local machine user, viewing progress and approving scope in chat or on the board. Worker: an active Claude Code session that selects and implements work. Reporter: local test or deployment scripts that submit objective results. Projects are whatever the owner creates or imports; nothing about a particular project is built into the product.

Included: Claude Code plugin installable from a plugin marketplace; local stdio MCP server; local SQLite records; Kanban board as a Claude Artifact using the local MCP server; static board snapshot fallback; plugin skill, slash commands and a SessionStart hook carrying the workflow instructions; evidence references; project and phase scoping; dependencies; guarded status transitions; durable reporting retries and resume reconciliation; shared project state across Claude sessions; informal intake; optional OpenSpec mapping; requirement coverage; human requested rework; import of a board exported from the ChatGPT edition. Claude Code (optionally with Superpowers skills) executes development; the tracker coordinates and records it.

Excluded initially: billing, a commercial project management suite, automatic outbound messaging, replacing CI or source control, unrestricted autonomous deployment, automatic restart of a stopped Claude session, network listeners of any kind, multiple human users, and live synchronisation with the ChatGPT edition's cloud board. Periodic detection and a shared hosted backend are later scope; execution restart requires a separately verified service.

## Delivery phases

| Stage | Delivery |
|---|---|
| MVP | One owner on one machine, multiple project capable schema, a neutral sample backlog for trying the workflow, Artifact board plus snapshot fallback, MCP workflow, script reporting, evidence gates, local retry queue, resume recovery, plugin packaging and ChatGPT-edition board import. |
| Next | Periodic stale work detection (Claude scheduled tasks), CI integration and additional projects; optional shared hosted backend (for example Cloudflare Workers + D1 with standards-based MCP OAuth) behind the existing storage and identity adapters, enabling multiple machines and collaborators with explicit authorization. |
| Later conditional | Automatic worker dispatch or restart only when execution capability and authorization are verified. |

## Ranked epics

| Rank | Epic |
|---|---|
| 1 | Identity project scope and reliable records |
| 2 | Backlog and acceptance criteria |
| 3 | Visual Kanban board |
| 4 | Claude workflow and task claiming |
| 5 | Functional test evidence |
| 6 | Deployment verification and release gates |
| 7 | Durable reporting and recovery |
| 8 | Reconciliation and proactive detection |
| 9 | Project continuity intake and source integration |
| 10 | Human feedback and rework |
| 11 | Claude plugin packaging and migration |

Ranking note: Project binding, intake and coverage in Epic 9 are foundational and start alongside Epics 1 and 2. Rework actions in Epic 10 must exist before any completion claim is accepted. Plugin packaging in Epic 11 is the delivery vehicle for every other epic and is built alongside Epic 1; its later numbering groups the platform requirements rather than delaying them.

## State model

Normal flow: Draft → Backlog → Ready → Implementing → Verifying → Ready to ship → Shipped. Draft holds unclear or unreviewed requests. Blocked records a reason, the prior state, the next action and the responsible dependency, and keeps the current attempt; when the blocker clears the story resumes to exactly the state it interrupted, subject to that state's own gates (an active lease, qualifying proof), or the owner moves it to Backlog to end the attempt. Needs rework withdraws current completion eligibility after a human reports incomplete behavior. Proof that stops qualifying (a failed check, a source change, rework) demotes Ready to ship to Verifying and Shipped to Needs rework; a worker may also move Verifying back to Implementing. Historical releases remain preserved.

| State | Entry requirement |
|---|---|
| Backlog | Story exists; scope may need clarification. |
| Ready | Phase approved, acceptance criteria testable, every dependency Shipped with qualifying deployed proof, no circular dependencies. |
| Implementing | Authorized worker claims the story with a current work attempt. |
| Verifying | Implementation commit identified; checks starting. |
| Ready to ship | Required criteria passed on the candidate commit; no unresolved critical failures. |
| Shipped | Release succeeded and deployed behavior was verified against required criteria. |
| Blocked | Reason, last known state, next action and responsible dependency recorded. |
| Draft | Unstructured or unresolved request awaiting scope confirmation. |
| Needs rework | Human reported missing behavior; current completion eligibility withdrawn pending classification and verification. |

An epic is an aggregate, not one oversized card. Cards represent stories or small phase specific slices. Epic progress is computed from its in scope stories; future phase work does not falsely block an MVP completion.

## Epic 1 Identity project scope and reliable records

### SEC 01 Restrict board and tools to the local owner

As the owner, I want only my own local tools to inspect or update project records.

- The MCP server communicates only over stdio with the Claude Code process that launched it. It opens no network port. The data root is created with owner-only permissions (0700). The MCP server, command-line tool, hook and reporter scripts all run under umask 077 and create files with explicit owner-only modes, so every file in the data root, including SQLite's `-wal` and `-shm` side files, is readable only by the owner.
- Credential-looking text is redacted from free-text fields of every write (output, commands, reasons, titles); identifiers such as IDs, bindings, branches and commits are never rewritten. Claim lease tokens are local coordination values kept in the owner-only database, never shown on the board or in snapshots, and removed from exports.
- Every mutation carries an actor. MCP calls act as the local owner (`local:<os user>`). Reporter scripts construct a reporter actor scoped to the project, story and work attempt named in their configuration, and the transport rejects a scope whose attempt does not exist on that story. For a reporter actor the engine permits only begin_run, record_evidence, record_release, heartbeat_attempt, checkpoint_attempt and restore_checkpoint for that scope; it rejects editing acceptance criteria, authorizing scope, claiming work, reopening stories and every other action. This is a guard against mistakes and over-broad automation, not authentication.
- The Artifact board reaches the MCP server only through the Claude app's host MCP bridge and only for the tools named in its manifest: the redacted read tools (list_projects, board_overview, story_detail) and request_rework. Raw get_board output, which contains lease tokens and full evidence output, is never exposed to the page. To be verified during implementation: per-viewer consent prompts and the restriction on public sharing for pages that declare a local server.
- Trust boundary is documented honestly: any process running as the same OS user can read or modify the database file. No credentials are required; secrets never enter the database, checkpoints, outbox, source or routine logs. Credential checks match secret value patterns and an explicit key denylist; benign keys that merely contain the word "token" (for example `max_tokens` in test output) never reject a checkpoint, while credential-looking values in captured output are redacted before they are stored.

### DAT 01 Persist versioned work records

As the owner, I want the board to survive sessions and retain its history.

- All local state lives under one data root, `~/.cogumi-claude-kanban/` (override with `COGUMI_KANBAN_HOME`): `kanban.db` (override with `COGUMI_KANBAN_DB`), `outbox/` with `outbox/.rejected/` (override with `COGUMI_OUTBOX`), `runs/` (override with `COGUMI_RUNS`), `snapshots/`, and `configs/` for non-secret reporter configurations. Checkpoints are stored in the database; an additional copy is written to `COGUMI_CHECKPOINT_DIR` when the owner configures separate durable storage. The plugin's own install directory holds no data, so uninstalling or updating the plugin never deletes records.
- Use one local SQLite database for projects, epics, stories, criteria, work attempts, events and evidence metadata. Evidence files remain on local disk or in the product repository and are stored as authorized durable references.
- Use optimistic version checks for edits and atomic compare-and-swap status changes so concurrent Claude sessions, scripts and the board cannot silently overwrite evidence. The MVP keeps the engine's model of one JSON board document per owner with whole-document compare-and-swap; on a conflict the storage adapter re-reads and retries the same request with the same event ID a bounded number of times (the engine is idempotent per event ID). Use SQLite WAL mode and a busy timeout so concurrent local processes wait instead of failing immediately.
- Retain an append only audit history of actor, transition, reason, timestamp and relevant commit. Derived UI state must agree with authoritative records.
- Storage and identity sit behind small adapters so a hosted backend can replace them later without changing the workflow engine.

## Epic 2 Backlog and acceptance criteria

### BKL 01 Import an approved project plan

As the owner, I want the PRD converted into an actionable backlog.

- Import epics and phase specific stories with stable IDs, priority, scope, dependencies and acceptance criteria. Show a preview before committing an ambiguous import.
- Repeat imports update matched records without duplicates; changed criteria create a new revision rather than invalidating history silently.
- No project is built in; the plugin ships only a neutral sample backlog (`plugin/samples/sample-backlog.json`) for trying the workflow. Keep an approved scope reference and source document version.

### BKL 02 Map criteria to verification

As a developer, I want a proof plan before implementation.

- For each criterion define verification type, expected result and evidence requirement: browser, API, integration, deterministic logic, human review or model evaluation.
- Any waived criterion needs explicit owner authorization, rationale and scope. Blocked checks are not passes.
- Permit a story to be Ready only when criteria are testable and dependencies satisfied; circular dependencies are reported.

## Epic 3 Visual Kanban board

### UI 01 See current delivery state

As the owner, I want a simple live board instead of a paid project management subscription.

- The board is a Claude Artifact page provided by the plugin and published on request (`/cogumi-claude-kanban:board`). It reads live data from the local MCP server through the Artifact `mcp` capability, using the redacted board_overview and story_detail read tools.
- Show columns for all lifecycle states, cards with story and epic, phase, priority, actor, update time and blocker indicator.
- Filter by project, phase and epic; order ready work by approved priority and dependencies. Support an epic summary and story detail view. Filtering never shrinks completion denominators.
- Refresh saved changes without republishing the Artifact by registering an Artifact `watchTool` on board_overview with a requested refetch interval of 15 seconds, plus a manual refresh button. The Claude app may clamp polling to its own floor (about 30 seconds) and pauses it while the page is hidden; the board shows the time of the data it displays, never the time of the last poll. Show last refresh time and a visible stale or unavailable status, including "local server not connected" when the page is opened outside the Claude desktop app on the owner's machine.
- Provide a static snapshot fallback: the same page rendered with embedded data by a local command into a local HTML file, clearly labeled as a snapshot with its capture time, for viewing without the live bridge. The snapshot is never published as an Artifact automatically, because that would copy records off the machine. If the live host bridge turns out to be unavailable, the snapshot is the MVP acceptance path for UI 01 and UI 02.

### UI 02 Inspect proof and limitations

As the owner, I want to inspect why a card is complete.

- Story details expose criteria, results, tested commit, environment, commands, execution time (duration and finish time), artifacts (an https reference recorded by the wrapper) and release link. Unmapped requirements are listed by ID with their source revision.
- Show pass, fail, blocked, pending and authorized waiver distinctly. Screenshots cannot substitute for behavioral checks.
- Initially the board is read only except for reporting rework (REW 01). Confirm actual rendering of the page before relying on it.

## Epic 4 Claude workflow and task claiming

### WRK 01 Select and claim eligible work

As an active Claude worker, I want to select the next story without conflicts.

- Get next ready story considers project, authorized phase, priority and dependencies. Claim is atomic and creates an attempt and ownership lease.
- Two workers (for example two Claude sessions or worktrees) cannot claim the same active story accidentally. Expired claims become stale and require reconciliation before reassignment.
- Before implementation, record story ID, branch or checkout, starting commit and acceptance plan. Handle unavailable information explicitly.

### WRK 02 Update status through the workflow

As the owner, I want Claude to maintain the board as it works.

- Plugin instructions require reading active state on start or resume, claiming before coding, reporting blockers and using standard verification and release commands. The instructions are delivered four ways: the MCP server's initialize instructions, a plugin skill, slash commands, and a SessionStart hook that, when the working directory resolves to a bound project, gives Claude the project, the Claude session ID to use as thread_id, the plugin script path and the pending/rejected outbox counts, and reminds it to reconcile. The workflow guide is rewritten for Claude with no Codex or Sites references.
- Expose tools for retrieving work, claiming, updating status, recording evidence, recording a release and reconciling state. Tool responses show whether each mutation was saved. Read-only tools are annotated as read only.
- Continue to the next eligible story within the approved execution scope. A tracker update cannot broaden implementation or deployment authorization. Owner-only tools are executed by Claude only after explicit owner approval in the conversation. Because Claude's MCP calls run as the owner actor (as in the ChatGPT edition), this rule is enforced by the instructions, not by the engine.
- Installing the plugin does not start or keep alive a worker. Verify the instructions survive plugin installation before relying on them.

## Epic 5 Functional test evidence

### TST 01 Report results from standard commands

As a developer, I want test reporting to happen as part of executing checks.

- A project specific wrapper runs real checks, captures exit status and results, saves evidence locally and submits a uniquely identified event to the local database.
- Record criterion IDs, exact tested commit, dirty working tree state, environment, command, test run ID and artifacts. Identify mocked versus real integrations.
- Report failure even when a command crashes. A result with incomplete provenance cannot satisfy a required gate.

### TST 02 Enforce proof appropriate to the criterion

As the owner, I want functionality proven rather than inferred from test counts.

- Browser flows assert outcomes and preserve traces or screenshots where useful; API checks verify responses and saved state; isolation tests attempt cross user and cross scope access.
- Run relevant regression checks and compare implementation to the approved criteria. Build or lint success alone cannot establish functionality.
- For LLM products, record coaching evaluation separately from deterministic application tests. Human judgment or model evaluated results are labeled, not presented as deterministic guarantees.

## Epic 6 Deployment verification and release gates

### SHP 01 Gate release readiness

As the owner, I want missing proof to prevent false completion.

- Backend allows Ready to ship only when required checks qualify for the intended source version and critical failures are resolved.
- Any source change after a passing run invalidates eligibility for affected checks; use a conservative full gate invalidation initially.
- Pending reporting or unreachable evidence marks status unverified. A success summary from a worker is not sufficient.

### SHP 02 Record and verify a deployment

As a developer, I want a shipped card tied to a verified release.

- The standard release command records the project's actual provider result: provider, deployment ID, version identifier, deployed source commit, status, environment and observed HTTPS URL. The release command requires all of these, and the environment must come from the provider's result and match the reporter configuration; the underlying record_release tool requires commit, version, URL, environment and result, with provider and deployment ID optional for manual records. The MVP engine requires an HTTPS URL; releases without one (for example a package publish) record the provider's HTTPS release page.
- Wait for successful deployment and run prescribed checks against the deployed version. Do not synthesize release URLs.
- Shipped requires qualifying pre release evidence plus deployed verification. Failed deployment stays Ready to ship or becomes Blocked with the reason.
- The tracker is provider neutral. Claude records structured provider results from whatever publisher the project uses; do not claim an event driven provider integration exists without testing it.

## Epic 7 Durable reporting and recovery

### REL 01 Recover missed reporting

As the owner, I want a database outage to delay reporting rather than lose it.

- Save events in a local outbox before attempting delivery. The outbox, run journals and checkpoints live under the data root (DAT 01), outside the product checkout, so reporting never dirties the product source or edits Git configuration (the ChatGPT edition's `.git/info/exclude` edits and `.openai/hosting.json` reads are removed).
- Retry transient failures (for example a locked database, a missing database file or an unknown project, which usually mean a wrong data root) with bounded backoff; retain failure state visibly. A permanently rejected event is moved to a visible rejected area with its reason instead of blocking every later event forever; the run whose result was rejected is recorded as blocked (never left unresolved, never passing). Rejections nothing waits on (a run registration that created no run, a heartbeat or checkpoint, or a result whose run already has a recorded outcome) are filed away automatically as resolved history; resume and before-close exit non-zero while pending or unresolved rejected events remain; an explicit requeue command resends an event after its cause is fixed, and an owner-approved discard command files one away with a reason. Reporter scripts never create a database.
- Use unique event IDs and backend idempotency; duplicate delivery cannot create duplicate evidence or transitions.
- Local files can disappear. Allow checkpoints on separately approved durable storage (`COGUMI_CHECKPOINT_DIR`) without credentials; document the durability boundary.
- Out of order events are accepted as history but cannot override a newer attempt or source version.
- A failed heartbeat is recorded as a warning; it does not kill the running check.

### REL 02 Resume interrupted work safely

As an active Claude worker, I want to recover the actual state after interruption.

- On start or resume, inspect pending events, active claim, source state, saved test runs and known releases; reconcile before proceeding.
- Distinguish implementation failure, report delivery failure and a stopped worker. No missing signal is interpreted as success.
- Reclaim or release a stale story only after verifying prior work and ownership. Preserve diagnostic information and avoid duplicate deployment.

## Epic 8 Reconciliation and proactive detection

### REC 01 Reconcile at workflow checkpoints

As the owner, I want missed updates detected without relying only on model memory.

- Run reconciliation on start or resume, after standard test and deployment commands, and before closing a story.
- Compare board eligibility to current commit, qualifying evidence and release state; repair only provable discrepancies and record the repair.
- Conflicting or unverifiable state is flagged for investigation rather than silently marking complete.

### REC 02 Detect stale work periodically (Next stage)

As the owner, I want stale claims and undelivered results surfaced proactively in the next stage.

- Use a supported schedule (for example a Claude scheduled task) to inspect stale claims, failed reporting and outdated gates; surface them on the board with last reconciliation time.
- Use a lease heartbeat or bounded expected activity window so long tests are not mistaken for a dead worker. Thresholds are configuration, not guessed facts.
- The scheduler can detect and reconcile authorized records but cannot restart Claude unless a supported execution mechanism is separately implemented and authorized.

## Epic 9 Project continuity intake and source integration

### PRJ 01 Maintain one project view across sessions

As the owner, I want all project conversations to use one shared board.

- Bind an opaque project ID to the repository identity. The binding is the normalized Git `origin` URL (`https://<host>/<path>` with SSH forms, credentials, trailing slashes and `.git` removed), or `local:<real path of the Git common directory>` when no remote exists; the common directory is shared by every worktree of the repository. The binding-to-project mapping lives only in the database (resolve_project), so nothing is written into the product checkout and reporter runs stay clean. A moved or re-hosted repository is re-associated explicitly with add_binding. Claude sessions record associations and work attempts, not independent duplicate boards.
- The SessionStart hook supplies Claude Code's session ID, which Claude passes as thread_id to start_session and associate_thread (the tool field keeps its original name).
- On start or resume, resolve the binding and retrieve active stories, blockers, evidence and recent results. Ask for project selection if ambiguous; never guess from a similar title.
- Validate project and repository identity before mutations. Support multiple repositories through explicit bindings. Branches and worktrees remain part of the same project unless explicitly separated.
- Test two sessions updating the same project and reject conflicting writes or duplicate active claims. Ending a session does not delete project state.

### INT 01 Create a backlog without a PRD

As the owner, I want to track work from an informal request.

- Claude follows plugin intake instructions to extract goals, scope, proposed stories and testable acceptance criteria. There is no separate coach agent or extra LLM service.
- Keep ambiguous or unreviewed requirements Draft and outside the autonomous execution queue. Show the proposed scope for user review before execution.
- Use one story for a small change; create epics only when grouping is useful. Respect prior authorization and do not repeat approval for unchanged reviewed scope.
- New requests during execution become proposed additions or criterion revisions; preserve the original request and decision history.

### COV 01 Map every approved requirement

As the owner, I want omitted work detected before an epic looks complete.

- Map every approved requirement to one or more stable story IDs or an explicitly authorized exclusion. Display unmapped requirements and their source revision.
- Compare imported backlog against the full source, not only tasks already present. Prevent scope completion claims while required coverage is unresolved.
- Removing or deferring a required story requires an explicit owner decision, rationale and revised phase scope: exclude_story records the reason, the phase the story came from and `deferred_to` (the phase it moves to, or "removed"; required on strict projects), and the board shows it. Keep removed records and historical evidence auditable.

### EPC 01 Compute phase specific epic completion

As the owner, I want missing stories to keep an epic incomplete.

- Compute progress from required stories for the selected phase: for example four of five shipped, with remaining story names. Do not permit manual green status to bypass child work.
- Phase complete requires all required in scope stories shipped with qualifying current evidence; authorized exclusions are visible separately, not counted as shipped.
- Distinguish MVP complete from entire epic complete. A reopened or Needs rework child immediately flags the epic and withdraws affected completion claims.
- Test missing, blocked, waived, deferred and reopened children and verify denominators and labels.

### OSP 01 Integrate OpenSpec optionally

As a developer, I want a board for OpenSpec work without a competing specification system.

- When present, OpenSpec files in Git remain the source of truth for requirements, scenarios, proposals and tasks. Kanban owns operational state, claims, blockers, proof and releases.
- Import using the verified installed OpenSpec format; map project, change, source path, source revision, requirement or scenario reference and task to stable tracker IDs. Do not assume every task equals one story.
- Reimports reconcile additions and changes without duplicates. Deleted or materially changed requirements become review items; retain historical mappings and invalidate affected evidence where needed.
- OpenSpec checked tasks, archive state and verification reports are signals, not shipped verdicts. Functional execution and deployed verification gates remain mandatory.
- Claude proposes source changes through the appropriate OpenSpec workflow; board status writes do not silently rewrite requirements. PRD and informal intake still work when OpenSpec is absent.

## Epic 10 Human feedback and rework

### REW 01 Report incomplete work

As the owner, I want to correct completion claims from the board or chat.

- Allow Needs rework on a selected story through the Artifact board or MCP; capture observed behavior, expected outcome and optional reproduction details.
- Flag the story and parent epic immediately. Classify as unmet approved requirement, regression, additional scope or ambiguous requirement; classification does not erase the report.
- Reopen unmet work; link regressions to corrective work; place new scope in Draft for review. Preserve prior release and assessment history.
- Only the owner can reject or revise scope; reporting technical evidence does not grant a script that authority.

### REW 02 Verify a corrective implementation

As the owner, I want reported failures fixed with evidence.

- For reproducible defects, create a check that demonstrates the reported failure before the fix; record failures that require manual reproduction honestly.
- Fix, run affected acceptance checks and regressions, deploy within authorized scope and verify the correction on the deployed version.
- Old passing results cannot close the rework report. Associate the new attempt, criterion revision if changed, source commit and release with the report.
- If the human says behavior is still incomplete, keep rework open; do not override the report simply because an automated test passed.

## Epic 11 Claude plugin packaging and migration

### PLG 01 Install as a Claude Code plugin

As the owner, I want to install the tracker with Claude Code's plugin system.

- Ship a plugin (`cogumi-claude-kanban`) with `.claude-plugin/plugin.json`, a marketplace manifest, an MCP server definition, a workflow skill, slash commands and a SessionStart hook. Installation is `/plugin marketplace add <path or Git URL>` followed by `/plugin install cogumi-claude-kanban@cogumi`.
- The MCP server, hook, command-line tool and the library the reporter scripts import ship as bundled JavaScript (dependencies included, no TypeScript at runtime); the reporter scripts themselves are plain dependency-free JavaScript modules. Installation needs no package manager step. They require Node.js 22.13 or newer. A launcher (`bin/run-node.sh`, used by every instruction through the `bin/kanban` wrapper) locates `node` even when the desktop app does not inherit the shell PATH (PATH, then Homebrew, `/usr/local`, nvm, Volta and fnm locations) and prints an actionable error if no suitable version is found.
- The plugin creates its data root on first use and never writes into the product checkout.
- Uninstalling the plugin does not delete the database.

### PLG 02 Publish the Artifact board

As the owner, I want the board as a Claude Artifact.

- A slash command copies the board page template from the plugin into the session's scratchpad, fills in the host server name, and publishes it with an `mcp` capability manifest naming the plugin's local server as a host server and only the board's tools.
- The page works only where the Claude desktop app has the plugin's server connected; elsewhere it shows a clear not-connected state and suggests the snapshot command.
- The host server name is derived from the running session's tool names at publish time rather than hardcoded, because it depends on the plugin and server names.
- To be verified during implementation: that a plugin-provided MCP server is reachable as an Artifact host server. If it is not, the documented fallback is registering the same server in the user's MCP configuration, and the snapshot remains available.

### MIG 01 Import an existing ChatGPT-edition board

As the owner, I want my existing Cogumi Kanban progress available in Claude.

- The ChatGPT edition has no export tool, so the export is produced by asking Codex (with the Cogumi Kanban plugin) to call `get_board` for each project from `list_projects` and save the results unmodified as one JSON array to a file.
- Import that file into the local database in one atomic write. The importer strips derived fields (`metrics`, `summary`, per-story `eligibility`), expires every active claim and removes lease tokens so imported in-progress work must be reconciled and recovered before continuing, keeps the old `site:` and repository bindings on the project as history (a `site:` binding can never match a local repository), rejects project IDs that are not valid identifiers and bindings shared by two projects in the same export, and requires an explicit add_binding to the local Git binding before work resumes.
- Preserve project IDs, story IDs, attempts, evidence, releases and history, including the original actor IDs in audit records. Re-importing a project whose ID already exists is a no-op that reports zero changes unless the owner explicitly passes `--replace`; a binding collision with a different project is refused. Report counts imported.
- The original Site is left untouched; migration is one-way and a copy. Reporter credentials from the old Site are not imported.

## Architecture and integration boundaries

Claude Code plugin containing: a stdio MCP server (Node.js, built-in `node:sqlite`) that wraps the platform-neutral workflow engine; a local SQLite database outside any product checkout; a Kanban board Artifact page that calls the MCP server through the Claude app's host MCP bridge; a snapshot command that renders the same page with embedded data; reporter scripts that deliver through the same engine using a scoped reporter actor; a workflow skill, slash commands and a SessionStart hook. Platform-specific code from the ChatGPT edition that is rewritten rather than reused: the HTTP reporter transport and bearer credentials, Site bindings, `.git/info/exclude` edits, the heartbeat failure that killed running checks, the outbox head-of-line block on permanent rejections and the over-broad credential key check. Development runs in Claude Code outside the tracker and reports via MCP tools or the reporter scripts.

Workflow driven updates rely on an active Claude session and plugin instructions. Event driven updates are emitted by verified wrappers or CI hooks. The durable outbox and engine gates address reporting failure; resume and (later) scheduled reconciliation address missed signals. None is an unconditional guarantee of execution.

Required entities: project, epic, phase, story, criterion revision, dependency, work attempt, claim lease, status event, verification run, evidence artifact, release record, reporting event and reconciliation record. Actor and project scope accompany mutations. Add project bindings, session associations, source revisions, requirement coverage mappings, scope decisions, rework reports and OpenSpec adapter mappings.

Git contains product code and approved executable acceptance definitions. The tracker stores operational status and proof references. Record the commit that was tested; do not introduce a new code commit solely for a board status update and accidentally invalidate the release candidate.

## Acceptance scenarios for the tracker

1. Import the same backlog twice without duplicate stories; preserve IDs and history.
2. Two simultaneous claims result in one winner and a clear conflict for the other, including two separate processes on the same database file.
3. A failed functional check cannot produce Ready to ship; a missing deployed check cannot produce Shipped.
4. Change code after passing tests and verify the old evidence no longer qualifies.
5. Make the local database unavailable during a test run, retain results in the outbox, restore it and replay once without duplication.
6. Deliver older results after a newer attempt and verify no state regression.
7. Stop and resume a worker; reconcile the source and active card without inventing completion.
8. Deploy unsuccessfully and verify the card is not Shipped; successfully deploy and verify required behavior before shipping.
9. A reporter scoped to one attempt cannot change criteria, authorize scope, claim work, or submit evidence for another story or project.
10. Board updates appear after refresh without republishing the Artifact; stale or disconnected data is visibly labeled.
11. Resolve the same project from two separate Claude sessions and retain one board and stable story IDs.
12. Convert an informal request into Draft stories; executable work starts only after scope review.
13. Import an OpenSpec change twice, then modify or delete a requirement; show review items without duplicate stories or silent scope removal.
14. Leave one required story unfinished and verify the epic cannot display phase complete.
15. Report a shipped story incomplete through chat and the Artifact board; withdraw completion, preserve history and require new corrective evidence.
16. Install the plugin from its marketplace into a clean Claude Code configuration; the MCP tools, skill, commands and hook load and the server starts without a package install step.
17. Import a ChatGPT-edition board export; counts and IDs match, claims are expired, derived fields are absent, and a second import of the same export is a no-op reporting zero changes.
18. Running the reporter wrapper leaves the product checkout's Git status and Git configuration unchanged.
19. A check whose output contains keys such as `max_tokens` or text such as `Bearer abc` is checkpointed and recorded successfully, with credential-looking values redacted.
20. A permanently rejected outbox event is moved to the rejected area with its reason, later events are still delivered, the affected run is recorded as blocked, `observe`, the SessionStart hook and the checkpoint's delivery error surface the rejected events, and start_session records the observed rejected count so a strict claim is refused while it is above zero.
21. A heartbeat failure during a running check is recorded as a warning and the check runs to completion.
22. Two worktrees of the same repository, and SSH versus HTTPS clones of the same origin, resolve to the same project.

## Success measures

Measure accepted criteria with qualifying evidence, shipped records linked to verified releases, prevented invalid transitions, duplicate event count, unresolved stale work, reporting recovery time and manual owner correction frequency. Establish baselines during the first tracked epic; do not claim zero bugs from green checks.

## Dependencies and open decisions

Verify that plugin-provided MCP servers are reachable as Artifact host servers in the Claude desktop app, the Artifact manifest's per-tool allowlisting and consent behaviour, evidence artifact retention, test runner compatibility and any periodic schedule. Decided during implementation: a claim lease lasts one hour and is renewed by the test wrapper's heartbeat (configurable interval, default 60 s) or by renew_claim; delivery retries a transient failure three times with backoff before retaining the event; MCP writes retry a compare-and-swap conflict up to six times. Evidence retention remains open. Owner approved scope must specify which project, phase and environments Claude may autonomously change or deploy.

## Appendix A — Platform mapping from the ChatGPT edition

| ChatGPT Sites edition | Cogumi Claude Kanban |
|---|---|
| Private ChatGPT Site (Next/vinext on Cloudflare) | Claude Code plugin; no hosted site |
| Cloudflare D1 | Local SQLite via `node:sqlite` (same compare-and-swap model) |
| Sites-hosted HTTP MCP endpoint, ChatGPT identity headers | Local stdio MCP server; owner is the local OS user |
| HTML Kanban dashboard on the Site | Claude Artifact board using the `mcp` host capability, plus snapshot fallback |
| `/api/report` with scoped bearer credentials and Site service admission | Reporter scripts deliver directly to the local engine as a scoped reporter actor; no credentials |
| Plugin instructions packaged by Sites | MCP initialize instructions + plugin skill + SessionStart hook + slash commands |
| `site:<Site ID>` bindings via `.openai/hosting.json` | Normalized Git origin URL or `local:<git common dir>` bindings, resolved from the database (no file in the checkout) |
| Sites native publishing | Provider-neutral release recording |
| Codex worker | Claude Code session |
| R2 (optional) | Local files / repository references |
