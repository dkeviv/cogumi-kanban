# Cogumi Kanban

Local progress tracking for Codex and Claude. Kanban records delivery-agent milestones; it does not run product tests, deploy or launch coding agents.

## Progress workflow (v2.7)
Auto is the default: routine tracker updates need no approvals. Approval mode stores proposed reports until the user approves the exact update. A goal does not change the selected mode.

Use `record_progress` once for all affected stories at implementation, verification, release, blocker and final-response checkpoints. Supply a stable event ID, worker identity, milestone, summary and actual references. Retry unchanged events safely. CLI agents can use `sh /path/to/plugin/bin/kanban cli progress --file REPORT.json`: it saves the report in an owner-only outbox before delivery, and the update command retries pending reports. Milestones are visibly reported by the agent, separate from independently qualified evidence. Epic counters show Implemented / Verified / Released. A commit alone never establishes completion.

`/cogumi-kanban:update-kanban` reconciles repository/outbox state and missing or stale progress without blocking development. `/cogumi-kanban:open` opens the local board on either host. Auto assesses Ready from criteria and implemented dependencies, without requiring test plans. Changed scope stays Draft until assessed. Codex needs explicit workflow invocation at new session start; Claude receives a session reminder. No guarantee is made for work never reported by an arbitrary chat.

Legacy worker start/run are disabled; status/stop remain for cleanup. Existing local databases and evidence are preserved.



Local delivery tracking for Codex and Claude. One shared SQLite tracker records story claims, actual check results, releases, rework and requirement coverage. A live Kanban UI shows the same records on your machine. MIT licensed.

## One plugin, including setup

Install only `cogumi-kanban@cogumi`. Setup and reconnection are included: invoke `/cogumi-kanban:setup-cogumi` or ask “Set up Cogumi Kanban”. Start also performs setup before reconciliation. It preserves existing local projects and never seeds demo data. The obsolete `cogumi-kanban-setup` cloud plugin is not required.

## Requirements

- Node.js **22.13 or newer**, available on PATH. If necessary, set `COGUMI_NODE` to an absolute Node executable path.
- A POSIX shell (`sh`): macOS or Linux; Windows users need an equivalent environment such as WSL. Native Windows execution has not been verified.
- A current Codex desktop app/CLI or Claude Code installation with plugin support.
- Git for repository binding. Internet access is needed to install the plugin and for your AI host, but the tracker does not require a hosted backend or external account credentials.

No package-manager installation is required to run the installed plugin: runtime bundles are included. Development dependencies are only needed when changing its source.

## Install in Codex

From a terminal with the Codex CLI installed:

```sh
codex plugin marketplace add dkeviv/cogumi-kanban
codex plugin add cogumi-kanban@cogumi
```

Restart Codex to discover the installed skills and local MCP tools. Open a chat in the product's Git repository and ask “Start Cogumi Kanban”, then “Open Cogumi Kanban”. The board opens in Codex's browser panel when that capability is available.

## Install in Claude Code

```sh
claude plugin marketplace add dkeviv/cogumi-kanban
claude plugin install cogumi-kanban@cogumi
```

Restart Claude Code or start a fresh session, then run `/cogumi-kanban:start` from the product repository. `/cogumi-kanban:open` opens the local board in your browser. In a Claude host that supports Artifact publication and access to this local MCP server, the command can publish the live Artifact instead.

Claude Desktop does not automatically install Claude Code plugins. You can register the same local MCP server using your desktop client's supported MCP configuration; Artifact capability is detected rather than assumed. The browser board works without Artifact support.

## Commands and workflow

| Request | Action |
| --- | --- |
| `/cogumi-kanban:open` | Open the UI with host capability detection; `board` is an alias. |
| `/cogumi-kanban:update` | Reconcile repository observations, queues and missing/stale progress. |
| `/cogumi-kanban:mode auto` | Continue routine delivery across already approved scope. |
| `/cogumi-kanban:mode approval` | Review queue transitions manually. |
| `/cogumi-kanban:status` | Inspect current delivery status. |
| `/cogumi-kanban:snapshot` | Save a clearly labeled static board. |

Command menus differ by host/version. If a command is not listed, invoke the corresponding skill in chat: “Open Cogumi Kanban”, “Update Cogumi Kanban”, or “Set Cogumi Kanban to Auto mode”.

Start with a repository-bound project, import stories and map source requirements. Auto assesses criteria and dependencies to advance Ready work. Use the coding agent for implementation and tests, then report milestones with record_progress. Proposed or changed scope remains visible until assessed. Historical proof records remain accessible without blocking development.

Source titles and version metadata remain reference records. Actual cross-cutting obligations link across epics/phases; uncertain mappings remain unmapped. Reimports preserve audited classification repairs.

## Package structure and host integration

`plugin/plugin.json` and `plugin/mcp.json` are the portable Agent Plugins package used by Codex. Native skills live in `plugin/skills/`, so Codex does not need Claude-command conversion. Claude uses `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json` and `plugin/commands/`. Both manifests describe the same name/version and launch the same local runtime; the data and board are shared.

Claude Code additionally supports the packaged SessionStart hook. No Codex startup hook is declared or promised: its workflow skill performs explicit reconciliation when invoked. Invoke Start/Update at the beginning of tracked work. This package cannot intercept arbitrary chat turns or commands in either host.

## Local data and UI

Fresh installations use `~/.cogumi-kanban/`. Upgrades retain the legacy data directory when present so existing workers, evidence and outboxes keep working. `COGUMI_KANBAN_HOME` overrides the directory; `COGUMI_KANBAN_DB` overrides the database path. Host installations on the same machine use the same data home.

The local UI binds to `127.0.0.1` on a selected port, uses a private random URL, validates Host/Origin and exposes only redacted reads. Keep its server running while viewing the board. Do not publish the private URL. Record changes and rework through the tracker in chat; the local browser UI is read-only.

## Install from source / contribute

```sh
git clone https://github.com/dkeviv/cogumi-kanban.git
cd cogumi-kanban
codex plugin marketplace add .
codex plugin add cogumi-kanban@cogumi
# Or: claude plugin marketplace add .
#     claude plugin install cogumi-kanban@cogumi
```

To develop:

```sh
cd plugin
npm ci
npm run verify
```

Commit the generated `dist/` runtime bundles with source changes. Update synchronized package/manifests/marketplace versions before reinstalling; do not edit host caches. Requirements and historical design documents are in `requirements/`. They describe design intent, not evidence that every host behavior has passed acceptance.

## License

[MIT](LICENSE). Packaged runtime includes MIT license text and [third-party notices](plugin/THIRD_PARTY_NOTICES.md).

## Tracking responsibilities
The coding agent performs implementation and verification. Kanban records reports and flags missing or stale updates. Auto never asks for routine tracker approval. Historical qualified-proof APIs remain available for reading/reporting old evidence; they do not define the implementation counter.
