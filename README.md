# Cogumi Kanban

A local plugin for Codex and Claude that keeps an evidence-gated delivery board while an agent implements, tests and releases approved work. Records live in SQLite on your machine. `/cogumi-kanban:open` detects the host and opens the live board in Codex, a supported Claude Artifact, or your browser.

The product and plugin are named Cogumi Kanban. Existing installations retain their database and running-worker paths during the rename; new installations use `~/.cogumi-kanban/`.

## Contents

| Path | What it is |
|---|---|
| `requirements/Cogumi_Claude_Kanban_PRD.md` | Historical product requirements (v2.1) |
| `requirements/Cogumi_Claude_Kanban_PRD.docx` | Same PRD as a Word document |
| `requirements/original/` | The ChatGPT edition's PRD v1.1, for traceability |
| `requirements/COVERAGE.md` | Requirement-by-requirement coverage with the code and tests that satisfy each item |
| `.claude-plugin/marketplace.json` | Marketplace (`cogumi`) listing the plugin |
| `plugin/` | The plugin (`cogumi-kanban`) |
| `plugin/src/engine/` | Workflow engine (state machine, proof gates, claims, rework, OpenSpec) reused from the ChatGPT edition |
| `plugin/src/server/` | Local SQLite adapter, identity, service, MCP stdio server, redacted board views, reporter transport, binding, importer, snapshot |
| `plugin/src/cli/`, `plugin/src/hook/` | Command-line tool and SessionStart hook |
| `plugin/dist/` | Bundled, dependency-free builds of the above (what the plugin runs) |
| `plugin/scripts/` | Reporter scripts: durable outbox, checkpoints, test wrapper, workflow helper, OpenSpec import |
| `plugin/board/kanban-board.html` | The Kanban board page (Artifact and snapshot) |
| `plugin/skills/`, `plugin/commands/`, `plugin/hooks/` | Workflow skill, slash commands, hook registration |
| `plugin/tests/` | 151 tests: the original engine suites plus local storage, MCP, reporter scripts, import, board views, the board page (jsdom), hook, snapshot and packaging |

## Requirements

- Claude Code (desktop app for the live Artifact board).
- Node.js 22.13 or newer (`brew install node`). The launcher finds Homebrew, `/usr/local`, nvm, Volta and fnm installs even when the desktop app lacks your shell PATH; set `COGUMI_NODE` to override.

## Install

From a clone or an extracted copy of this folder:

```
/plugin marketplace add /path/to/cogumi-kanban
/plugin install cogumi-kanban@cogumi
```

Restart Claude Code (or start a new session). `claude plugin validate /path/to/cogumi-kanban` checks the manifests from a terminal.

## Use

| Command | What it does |
|---|---|
| `/cogumi-kanban:start` | Resolve this repository's project, reconcile pending reports, show the next story |
| `/cogumi-kanban:next` | Show and (on your say-so) claim the next eligible story |
| `/cogumi-kanban:status` | Read-only board summary |
| `/cogumi-kanban:board` | Publish the live Kanban board as an Artifact (desktop app, this machine) |
| `/cogumi-kanban:snapshot` | Write a static board snapshot to `~/.cogumi-kanban/snapshots/` |
| `/cogumi-kanban:import-chatgpt <file>` | Import a board exported from the ChatGPT edition |

The `cogumi-workflow` skill carries the full operating checklist: intake, planning, claiming, running checks, recording releases, rework and recovery.

Command-line tools all go through one wrapper that picks a suitable Node.js:

```
sh plugin/bin/kanban workflow binding | observe|resume|checkpoint|before-close|test CONFIG | release CONFIG RESULT.json
sh plugin/bin/kanban report flush | requeue [EVENT_ID...]
sh plugin/bin/kanban cli doctor | export --out FILE | import FILE [--replace] | snapshot [--project ID]
sh plugin/bin/kanban openspec SPEC_DIRECTORY MAPPING.json OUTPUT.json
```

`workflow test` exits 0 when the check passed and was recorded, with the command's own code when it failed, 2 when it ran but the result was not recorded, and 4 when the command was never run. `resume` and `before-close` exit 3 while pending or unresolved rejected events remain for the attempt. A rejected result is recorded as a blocked run, and rejections nothing waits on are filed away automatically; for the rest, fix the cause and `report requeue EVENT_ID`, or with the owner's approval `report discard EVENT_ID --reason "..."`.

## Where data lives

Everything is under `~/.cogumi-kanban/` (override with `COGUMI_KANBAN_HOME`; the database alone with `COGUMI_KANBAN_DB`; the outbox and run journals with `COGUMI_OUTBOX` and `COGUMI_RUNS`): `kanban.db`, `outbox/` (with `.rejected/`), `runs/`, `snapshots/`, and `configs/` for reporter configurations. Nothing is written into your product checkout. Uninstalling the plugin keeps the data. Back up with `sh plugin/bin/kanban cli export --out backup.json`.

Durability boundary: evidence waits in the outbox until delivered, and checkpoints are stored in the database. If the whole data root could be lost (a disposable workspace), set `COGUMI_CHECKPOINT_DIR` to separate durable storage so checkpoints are also written there before each delivery attempt. No tool can recover a result that only ever existed in files that were destroyed.

## Trust boundary

The MCP server speaks stdio to Codex or Claude. The board command opens a private loopback HTTP server. The owner is your OS user. Reporter scripts act as a reporter scoped to one project, story and attempt, which the engine enforces; this prevents mistakes, not a malicious process running as you. No external credentials are needed. Credential-looking text in tool input and captured output is redacted before it is stored. Claim lease tokens are short-lived local coordination values: they stay in the database (owner-only file), never appear on the board or in snapshots, and are removed from exports.

## Develop

```
cd plugin
npm install        # esbuild, zod and jsdom; development only
npm run build      # bundles src/ into dist/
npm test           # node --test, Node 22.13+
```

Commit `dist/` after building: the installed plugin runs the bundles without a package install. A packaging test fails if `dist/` is stale.

## Known limits

- The live board works only inside the Claude desktop app on the machine running the plugin; elsewhere it shows a not-connected state. Use the snapshot command for a portable copy. The Claude app may poll no faster than about every 30 seconds; use the board's Refresh button for an immediate update.
- Whether a plugin-provided MCP server is reachable as an Artifact host server has not yet been confirmed in the desktop app. If the board reports "not connected" while Claude Code can use the tools, register the same server in your own MCP configuration (`claude mcp add cogumi-kanban -- sh /path/to/plugin/bin/run-node.sh /path/to/plugin/dist/server.mjs`), republish the board (`/cogumi-kanban:board` picks up the new server name), and use the snapshot in the meantime.
- One owner on one machine. A shared hosted backend (for example Cloudflare Workers + D1 with MCP OAuth) is the documented next stage; storage and identity sit behind adapters for that reason.
- Periodic stale-work detection and worker restart are later scope (PRD REC 02).

## Codex live local board (2.0.2)

Run `sh plugin/bin/kanban cli board` from this source checkout (or the installed plugin's `bin/kanban`). Open the returned loopback URL in the Codex browser panel. Keep the process running. The board refreshes from the same local SQLite database used by the tracker and reporter; nothing is uploaded. Project, phase and epic filters, search and evidence detail are supported. The browser is read-only; use the tracker in chat for rework. The server binds only to 127.0.0.1 with a random URL, checks Host/Origin and exposes only redacted board reads. Existing Claude Artifact and snapshot modes are retained.

## Progress capture (2.1.0)

Use `/cogumi-kanban:update` to reconcile the board on demand, or ask “Update Cogumi Kanban” in Codex. The backing command is `sh plugin/bin/kanban cli update`, run from the product repository using the installed plugin's absolute path. It observes source state, queued reports and missing check files; saves a private report under the tracker data directory; and records a reconciliation. The board now flags expired claims, missing candidate/evidence, unknown runs and dirty/outdated proof. Use the existing tracked test runner for evidence and verified resume for recovery. Direct commands are not automatically intercepted. See requirements/Cogumi_Kanban_Codex_Progress_Addendum.md.

### Renamed commands (v2.2.0)

- `/cogumi-kanban:open`: open the local UI with automatic host detection.
- `/cogumi-kanban:update`: reconcile observed progress and report tracking gaps.
- `/cogumi-kanban:board`: alias for opening the board.

Replace the old plugin registration with `cogumi-kanban@cogumi` and restart the host to discover its new commands. Existing database, evidence and outbox records are preserved. The old data-directory spelling remains an internal compatibility fallback for workers already running.

### Auto and Approval delivery

Use `/cogumi-kanban:mode auto` to authorize routine delivery across the project's already approved phases and environments, or `/cogumi-kanban:mode approval` for manual queue review. Auto prepares the queue on imports, reconciliation and verified story closure. It does not launch an independent worker: the active delivery agent continues across epics, preparing proof plans and satisfying existing checks/releases. Actual blockers and unsupported acceptance remain visible.

Reference metadata remains in the source inventory but does not count as a delivery requirement. Cross-cutting requirements explicitly link across epics/phases; unchanged legacy reimports preserve audited classification repairs. Actual scope/criteria changes retain source review and evidence invalidation.
