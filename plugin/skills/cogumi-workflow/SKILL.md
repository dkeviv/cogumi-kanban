---
name: cogumi-workflow
description: Delivery workflow for Cogumi Kanban. Use whenever working in a repository bound to a Cogumi project, when the user asks to track work on the Kanban board, claim or ship a story, run checks with evidence, record a release, report rework, import a plan or OpenSpec change, or resume interrupted work.
---

# Cogumi Kanban workflow

The tracker is the `kanban` MCP server of this plugin (tools named `mcp__plugin_cogumi-kanban_kanban__*`). Records live in a local SQLite database under the resolved data home (`~/.cogumi-kanban/` for new installs; existing installations retain their legacy data home to preserve active workers). The full rules are the server's instructions (call the `workflow` tool if they are not in context). This skill is the operating checklist.

## Non-negotiables

- Never mark work complete on a summary. Ready to ship and Shipped are gates the engine enforces from registered runs, evidence and releases.
- Claim before editing code. Record the exact candidate commit with `set_commit`.
- OWNER operations require the relevant user authorization. A recorded Auto decision authorizes routine queue transitions and proof-plan preparation for unchanged approved criteria; quote that decision in reason. New scope/criteria, phase or environment expansion, exclusions, waivers and claim takeover still require approval for that exact decision. Do not ask again for unchanged routine work already authorized by Auto.
- Never invent URLs, release versions, test outcomes or pending counts. Observe them.
- User feedback beats a green test. If the user says it is still incomplete, use `request_rework`.
- Write nothing tracker-related into the product checkout. Reporter configs and provider result files go under the resolved data home’s `configs/` directory (or the scratchpad).

## 1. Resolve the project

1. `sh <plugin>/bin/kanban workflow binding`. `<plugin>` is the plugin directory: the SessionStart hook prints it, and the `workflow` MCP tool returns instructions with it filled in (or use `/cogumi-kanban:start`).
2. `resolve_project` with that binding. If none matches, `list_projects`; if the user confirms a new project, `create_project` (strict checks default on). If several match, ask.
3. `board_overview` for a compact view; `get_board` only when full records are needed.

## 2. Start or resume a session

1. If a reporter config exists for an active attempt: `kanban workflow observe CONFIG`, then `kanban workflow resume CONFIG`. Stop if it reports a prior worker still active. Exit code 3 means rejected events: their runs were recorded as blocked; read the reasons before continuing.
2. `start_session` with `thread_id` = the Claude session ID from the hook, the observed `binding`, `commit` (`git rev-parse HEAD`), and the actual `pending_events` and `rejected_events` counts from `kanban workflow observe` (0 only after checking). Strict claims are refused while either is above zero; resolve rejected events first.

## 3. Plan

- PRD or backlog: `preview_import`, show the preview, then `import_stories` with stable IDs, phases, priorities, dependencies, criteria and a `proof_plan` per criterion (type, expected, evidence_requirement, checks with id/kind/command/assertions). Then `set_requirements` with the **full** requirement inventory, including unmapped items. Pass the **same `source` and `source_revision`** to both calls; a different or missing revision marks every mapped story for source review and Ready is refused until the owner revises it.
- With strict checks (the default) each check's `command` must equal the reporter config's `command` joined with single spaces, exactly, and every criterion needs both a `functional` and a `deployed` check.
- Informal request: `propose_intake` (stories stay Draft), show it, and record the user's decision with `decide_intake`.
- Deferring or removing a story is an OWNER decision: `exclude_story` with `reason` and `deferred_to` (target phase or `removed`).
- Owner approves phases and environments with `approve_scope`. Move stories Draft → Backlog → Ready with `update_status` (Ready needs a `reason`; tool errors name any missing field).

## 4. Claim and implement

1. `next_story` picks eligible work. With strict checks, `claim_story` needs a `start_session` from the last 15 minutes with the same commit as `starting_commit` and `pending_events: 0`, so call `start_session` again if planning took longer or HEAD moved. `claim_story` with binding, worker (e.g. `claude:<session id>`), branch, exact starting commit and acceptance plan. Keep `attempt_id` and `claim.token` (the lease token) for this session's tool calls.
   - The lease lasts one hour. Record `set_commit` early, and call `renew_claim` before long stretches of work; `workflow test` renews it while checks run. If it expires before you recorded a commit and HEAD has moved, the owner moves the story to Backlog (ending the attempt) and you claim it again from the current HEAD; the code is safe in Git.
2. Write a reporter config (outside the checkout):

```json
{
  "project_id": "<project id>", "story_id": "<story id>", "attempt_id": "<attempt id>",
  "binding": "<binding>", "environment": "local", "kind": "functional",
  "command": ["npm", "test", "--", "checks/S1.test.mjs"],
  "criteria": [0, 1], "verification_types": ["api"], "check_ids": ["S1-api"],
  "mocked": false, "timeout_ms": 300000,
  "assertion_file": "/Users/<you>/.cogumi-kanban/configs/S1-assertions.json",
  "artifact": "https://ci.example.com/runs/42/trace.zip"
}
```

`assertion_file` must be under the data root or the system temp directory, because it is deleted before each run. `artifact` is optional (an https reference to a preserved trace, report or screenshot). For the deployed check use a separate config for the deployment environment:

```json
{
  "...": "same project_id, story_id, attempt_id, binding",
  "environment": "production", "kind": "deployed", "release_version": "<provider version_id>",
  "target_url": "<the release's observed https URL>",
  "command": ["npm", "run", "check:deployed"], "check_ids": ["S1-deployed"],
  "criteria": [0, 1], "verification_types": ["browser"], "mocked": false
}
```

3. Implement, commit, `set_commit` with the lease, `update_status` → Verifying.

## 5. Verify

- `sh <plugin>/bin/kanban workflow test CONFIG` runs the real command, registers the run, captures output, exit status, commit and dirty state, and delivers evidence through the durable outbox. The check writes `[{check_id,name,result}]` to `$COGUMI_ASSERTION_FILE`.
- Exit codes: 0 passed and recorded; the command's own non-zero code when the check failed; 2 when it ran but its result was not recorded (look at `kanban workflow observe`); 4 when the command was never run (configuration, binding or run registration refused; the message says why).
- Once functional proof qualifies, `update_status` → Ready to ship (the engine refuses otherwise; read the reasons).

## 6. Release and close

1. Deploy with the project's real publisher and wait for a terminal status. Save `{provider, deployment_id, version_id, commit_sha, status, url, environment}` from the provider's actual result to a JSON file. `environment` is required and must match the reporter config you pass.
2. `kanban workflow release CONFIG PROVIDER.json`.
3. Run the deployed checks with a config of `kind: "deployed"`, `release_version` and `target_url`.
4. `kanban workflow before-close CONFIG` (exit 3 = pending or rejected events remain; resolve them first), then `update_status` → Shipped with the lease.

## Rework, recovery, finish

- Blocked: `update_status` Blocked with `reason`, `next_action` and `dependency`. When the blocker clears, move it back to the exact state it interrupted (with the lease if that state needs one); moving it to Backlog ends the attempt instead.
- `request_rework` (observed/expected/reproduction/classification). Reproduce first with a failing run or `record_reproduction`; old passes never close it.
- Rejected events: a rejected result is recorded as a blocked run; `before-close` files away rejections nothing waits on and exits 3 only for unresolved ones. Fix the cause and `kanban report requeue EVENT_ID`, or, only with the owner's explicit approval, `kanban report discard EVENT_ID --reason "..."`.
- Stale claim: `reconcile` with observed commit and `pending_events: 0` (verified), then the owner's `recover_claim`.
- Finish: `board_overview` for the full phase summary, `project_metrics`, `reconcile`, and report what was saved and what is still blocked.

## Board

- `/cogumi-kanban:open` opens the live board and detects Codex or Claude automatically; `/cogumi-kanban:board` is an alias.
- `/cogumi-kanban:snapshot` writes a static HTML snapshot locally.

## Codex live board

In Codex, start `sh <plugin>/bin/kanban cli board` as a persistent terminal process. Read the actual returned URL and open it with `mcp__codex_app__open_in_codex` using a browser target. Do this when starting tracked project work or when the user asks to see the board. Keep the process running while the board is open. It reads the same local SQLite database and refreshes automatically. The browser board is read-only; record rework through the local tracker in chat. Never switch to a separately connected hosted Cogumi service for this local workflow. If no browser opener is available, return the observed URL.

## Mandatory progress capture and on-demand update

Run `sh <plugin>/bin/kanban cli update` in the bound repository at session start, before switching stories, after a blocker, and before any user-facing progress/completion report. Resolve warnings; expired claims mean interruption, not active work. Use `/cogumi-kanban:update` or “Update Cogumi Kanban” on demand. The update observes Git, queues and proof files, persists reconciliation, and never invents proof. Record blockers promptly with their reason, next action and dependency.

Use `workflow test CONFIG` for every reviewed proof command, even while implementing. It records started runs, renews claims during execution, journals outcomes before delivery and replays durable stable-ID events during verified recovery. Do not use direct test commands as completion evidence. Ordinary edits and commands outside the runner cannot be intercepted; report them as unverified until a recorded check on the exact clean commit qualifies. Implementation, registered checks, accepted proof and actual release are separate milestones. Never mark Shipped without all existing gates.

## Delivery modes

The project explicitly selects Auto or Approval with `set_delivery_mode` (or `/cogumi-kanban:mode auto|approval`). Preserve existing phase/environment authorization. A user's Auto request authorizes routine transitions and execution across all epics within that scope; do not ask again per story or epic. In Auto, approve_scope/import/reconcile and story closure automatically prepare the queue: eligible approved Draft stories enter Backlog; existing Ready gates determine promotion. Source changes, pending proposals, future phases, dependencies and missing plans remain visible. Approval is the default for existing projects until a mode decision is supplied. It requires review of queue transitions rather than automatic promotion.

When working in Auto, keep executing the next eligible story after closing each one: update/reconcile, next_story, claim, implement, tracked checks, actual release and deployed acceptance, before-close, Shipped, then the next epic/story. Stop for a real blocker, unsupported host acceptance, user input that is required, or exhausted eligible scope. Do not stop merely to request permission for unchanged approved work. Auto mode does not launch an independent background worker, bypass evidence, recover another worker's claim, or approve future phases.

## Source classification and cross-cutting traceability

Classify titles/version/owner metadata as `reference` before import; retain original text and provenance. Register actual obligations as `requirement`. Use `cross_cutting:true` for requirements applying to stories across epics/phases. Map each actual requirement to the stories whose acceptance plans cover it; keep uncertain mappings visibly unmapped. Never manufacture a story for a document heading or drop a real obligation to improve completion counts. `classify_requirements` repairs existing classification/mappings with an audited reason and retained history, without changing acceptance criteria, source text or claiming implementation. Criteria changes still require revise_story and invalidate proof.
