---
name: cogumi-workflow
description: Delivery workflow for Cogumi Claude Kanban. Use whenever working in a repository bound to a Cogumi project, when the user asks to track work on the Kanban board, claim or ship a story, run checks with evidence, record a release, report rework, import a plan or OpenSpec change, or resume interrupted work.
---

# Cogumi Claude Kanban workflow

The tracker is the `kanban` MCP server of this plugin (tools named `mcp__plugin_cogumi-claude-kanban_kanban__*`). Records live in a local SQLite database under `~/.cogumi-claude-kanban/`. The full rules are the server's instructions (call the `workflow` tool if they are not in context). This skill is the operating checklist.

## Non-negotiables

- Never mark work complete on a summary. Ready to ship and Shipped are gates the engine enforces from registered runs, evidence and releases.
- Claim before editing code. Record the exact candidate commit with `set_commit`.
- Tools whose description starts with `OWNER` change scope or authority. Call them only after the user approved that exact decision in this conversation, and quote the approval in `reason`.
- Never invent URLs, release versions, test outcomes or pending counts. Observe them.
- User feedback beats a green test. If the user says it is still incomplete, use `request_rework`.
- Write nothing tracker-related into the product checkout. Reporter configs and provider result files go under `~/.cogumi-claude-kanban/configs/` (or the scratchpad).

## 1. Resolve the project

1. `node <plugin>/scripts/workflow.mjs binding` (the SessionStart hook prints `<plugin>`; or use `/cogumi-claude-kanban:start`).
2. `resolve_project` with that binding. If none matches, `list_projects`; if the user confirms a new project, `create_project` (strict checks default on). If several match, ask.
3. `board_overview` for a compact view; `get_board` only when full records are needed.

## 2. Start or resume a session

1. If a reporter config exists for an active attempt: `workflow.mjs observe CONFIG`, then `workflow.mjs resume CONFIG`. Stop if it reports a prior worker still active.
2. `start_session` with `thread_id` = the Claude session ID from the hook, the observed `binding`, `commit` (`git rev-parse HEAD`) and the actual `pending_events` count from `observe` (0 only after checking). Investigate rejected events before claiming.

## 3. Plan

- PRD or backlog: `preview_import`, show the preview, then `import_stories` with stable IDs, phases, priorities, dependencies, criteria and a `proof_plan` per criterion (type, expected, evidence_requirement, checks with id/kind/command/assertions). Then `set_requirements` with the **full** requirement inventory, including unmapped items.
- Informal request: `propose_intake` (stories stay Draft), show it, and record the user's decision with `decide_intake`.
- Owner approves phases and environments with `approve_scope`. Move stories Draft → Backlog → Ready with `update_status`.

## 4. Claim and implement

1. `next_story` picks eligible work. `claim_story` with binding, worker (e.g. `claude:<session id>`), branch, exact starting commit and acceptance plan. Keep `attempt_id` and `claim.token` (the lease token) for this session's tool calls.
2. Write a reporter config (outside the checkout):

```json
{
  "project_id": "<project id>", "story_id": "<story id>", "attempt_id": "<attempt id>",
  "binding": "<binding>", "environment": "local", "kind": "functional",
  "command": ["npm", "test", "--", "checks/S1.test.mjs"],
  "criteria": [0, 1], "verification_types": ["api"], "check_ids": ["S1-api"],
  "mocked": false, "assertion_file": "/abs/path/assertions.json", "timeout_ms": 300000
}
```

3. Implement, commit, `set_commit` with the lease, `update_status` → Verifying.

## 5. Verify

- `node <plugin>/scripts/workflow.mjs test CONFIG` runs the real command, registers the run, captures output, exit status, commit and dirty state, and delivers evidence through the durable outbox. The check writes `[{check_id,name,result}]` to `$COGUMI_ASSERTION_FILE`.
- Exit codes: the command's own code on failure, 2 when the check passed but reporting failed (look at `observe`), 0 when passed and recorded.
- Once functional proof qualifies, `update_status` → Ready to ship (the engine refuses otherwise; read the reasons).

## 6. Release and close

1. Deploy with the project's real publisher and wait for a terminal status. Save `{provider, deployment_id, version_id, commit_sha, status, url, environment?}` to a JSON file.
2. `workflow.mjs release CONFIG PROVIDER.json`.
3. Run the deployed checks with a config of `kind: "deployed"`, `release_version` and `target_url`.
4. `workflow.mjs before-close CONFIG`, then `update_status` → Shipped with the lease.

## Rework, recovery, finish

- `request_rework` (observed/expected/reproduction/classification). Reproduce first with a failing run or `record_reproduction`; old passes never close it.
- Stale claim: `reconcile` with observed commit and `pending_events: 0` (verified), then the owner's `recover_claim`.
- Finish: `board_overview` for the full phase summary, `project_metrics`, `reconcile`, and report what was saved and what is still blocked.

## Board

- `/cogumi-claude-kanban:board` publishes the live Artifact board (Claude desktop app only).
- `/cogumi-claude-kanban:snapshot` writes a static HTML snapshot locally.
