# Cogumi Claude Kanban

A Claude Code plugin that keeps an evidence-gated delivery board while Claude implements, tests and releases approved work. Records live in a local SQLite database on your machine. The Kanban board is a Claude Artifact that reads the plugin's local MCP server live, and a static HTML snapshot is available anywhere else.

It is the Claude edition of Cogumi Kanban (originally a ChatGPT Sites plugin). The workflow engine and its gates are reused unchanged in behaviour; hosting, identity, storage, reporting transport, instructions and the board were rebuilt for Claude.

## Contents

| Path | What it is |
|---|---|
| `requirements/Cogumi_Claude_Kanban_PRD.md` | Product requirements for this edition (v2.0) |
| `requirements/Cogumi_Claude_Kanban_PRD.docx` | Same PRD as a Word document |
| `requirements/original/` | The ChatGPT edition's PRD v1.1, for traceability |
| `requirements/COVERAGE.md` | Requirement-by-requirement coverage with the code and tests that satisfy each item |
| `.claude-plugin/marketplace.json` | Marketplace (`cogumi`) listing the plugin |
| `plugin/` | The plugin (`cogumi-claude-kanban`) |
| `plugin/src/engine/` | Workflow engine (state machine, proof gates, claims, rework, OpenSpec) reused from the ChatGPT edition |
| `plugin/src/server/` | Local SQLite adapter, identity, service, MCP stdio server, redacted board views, reporter transport, binding, importer, snapshot |
| `plugin/src/cli/`, `plugin/src/hook/` | Command-line tool and SessionStart hook |
| `plugin/dist/` | Bundled, dependency-free builds of the above (what the plugin runs) |
| `plugin/scripts/` | Reporter scripts: durable outbox, checkpoints, test wrapper, workflow helper, OpenSpec import |
| `plugin/board/kanban-board.html` | The Kanban board page (Artifact and snapshot) |
| `plugin/skills/`, `plugin/commands/`, `plugin/hooks/` | Workflow skill, slash commands, hook registration |
| `plugin/tests/` | 115+ tests: the original engine suites plus local storage, MCP, scripts, import, board views, hook, snapshot and packaging |

## Requirements

- Claude Code (desktop app for the live Artifact board).
- Node.js 22.13 or newer (`brew install node`). The launcher finds Homebrew, `/usr/local`, nvm, Volta and fnm installs even when the desktop app lacks your shell PATH; set `COGUMI_NODE` to override.

## Install

From a clone or an extracted copy of this folder:

```
/plugin marketplace add /path/to/cogumi-claude-kanban
/plugin install cogumi-claude-kanban@cogumi
```

Restart Claude Code (or start a new session). `claude plugin validate /path/to/cogumi-claude-kanban` checks the manifests from a terminal.

## Use

| Command | What it does |
|---|---|
| `/cogumi-claude-kanban:start` | Resolve this repository's project, reconcile pending reports, show the next story |
| `/cogumi-claude-kanban:next` | Show and (on your say-so) claim the next eligible story |
| `/cogumi-claude-kanban:status` | Read-only board summary |
| `/cogumi-claude-kanban:board` | Publish the live Kanban board as an Artifact (desktop app, this machine) |
| `/cogumi-claude-kanban:snapshot` | Write a static board snapshot to `~/.cogumi-claude-kanban/snapshots/` |
| `/cogumi-claude-kanban:import-chatgpt <file>` | Import a board exported from the ChatGPT edition |

The `cogumi-workflow` skill carries the full operating checklist: intake, planning, claiming, running checks through `scripts/workflow.mjs test`, recording releases, rework and recovery.

## Where data lives

Everything is under `~/.cogumi-claude-kanban/` (override with `COGUMI_KANBAN_HOME`; the database alone with `COGUMI_KANBAN_DB`): `kanban.db`, `outbox/` (with `.rejected/`), `runs/`, `snapshots/`. Nothing is written into your product checkout. Uninstalling the plugin keeps the data. Back up with `node plugin/dist/cli.mjs export --out backup.json`.

## Trust boundary

The MCP server speaks only stdio to Claude Code and opens no port. The owner is your OS user. Reporter scripts act as a reporter scoped to one project, story and attempt, which the engine enforces; this prevents mistakes, not a malicious process running as you. No credentials are needed or stored; credential-looking text in captured output is redacted.

## Develop

```
cd plugin
npm install        # esbuild + zod, development only
npm run build      # bundles src/ into dist/
npm test           # node --test, Node 22.13+
```

Commit `dist/` after building: the installed plugin runs the bundles without a package install. A packaging test fails if `dist/` is stale.

## Known limits

- The live board works only inside the Claude desktop app on the machine running the plugin; elsewhere it shows a not-connected state. Use the snapshot command for a portable copy.
- One owner on one machine. A shared hosted backend (for example Cloudflare Workers + D1 with MCP OAuth) is the documented next stage; storage and identity sit behind adapters for that reason.
- Periodic stale-work detection and worker restart are later scope (PRD REC 02).
