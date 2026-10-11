# Cogumi Kanban

Local delivery tracking for Codex and Claude. One shared SQLite tracker records story claims, actual check results, releases, rework and requirement coverage. A live Kanban UI shows the same records on your machine. MIT licensed.

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
| `/cogumi-kanban:update` | Reconcile repository observations, queues and proof gaps. |
| `/cogumi-kanban:mode auto` | Continue routine delivery across already approved scope. |
| `/cogumi-kanban:mode approval` | Review queue transitions manually. |
| `/cogumi-kanban:status` | Inspect current delivery status. |
| `/cogumi-kanban:snapshot` | Save a clearly labeled static board. |

Command menus differ by host/version. If a command is not listed, invoke the corresponding skill in chat: “Open Cogumi Kanban”, “Update Cogumi Kanban”, or “Set Cogumi Kanban to Auto mode”.

Start by selecting or creating a project bound to the current repository, importing stories and source requirements, and authorizing the phases/environments to implement. Auto mode prepares approved Draft stories as Backlog and promotes them to Ready when reviewed criteria/proof plans and dependencies qualify. The active agent continues across epics; the plugin does not run an independent AI worker. Future phases, real blockers and incomplete proof plans remain visible.

Completed implementation is distinct from verified delivery. Ready to ship requires current, clean, real passing functional evidence. Shipped also requires a matching successful release, deployed checks and the required before-close reconciliation. Direct test commands outside the tracked runner are not automatically captured and cannot qualify a story from a chat summary.

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

### Auto mode and persistent delivery

Auto is the default for new projects and existing projects without a recorded mode. Explicit Approval selections are preserved. In Auto, the agent records owner workflow decisions without separate approval, while respecting the user's requested outcome and explicit constraints. Approval requires review of owner decisions. Both retain source, dependency, lease, test and release gates.

Use `/cogumi-kanban:worker start`, `worker status`, or `worker stop` in the product repository. The command detects Codex or Claude; CLI users can run `sh /path/to/plugin/bin/kanban cli worker start --host codex` (or `claude`). The corresponding CLI must be installed and signed in. Start installs a persistent local service. Selecting Auto alone does not launch a second worker.

macOS launch agents and Linux systemd user services restart the supervisor after failure and at login. Linux recovery before login requires systemd lingering configured by the user. The computer must be awake and online. Other platforms need an external service for supervisor/reboot restart. Saved host sessions permit resume. Failures use exponential backoff; unchanged blockers wait five minutes. Another worker's live claim causes waiting. Approval mode interrupts delivery and pauses the service; stop disables it. Private status and logs live under the data directory's workers folder.

The worker uses Codex's workspace sandbox and noninteractive approval policy, or Claude's Auto permission mode. Host security controls remain active and may block operations. Power loss, unavailable services, credentials and usage limits can interrupt delivery.

The live board shows completed epic counts, stories in epic lanes across lifecycle states, and readiness blockers. Source revision fingerprints remain in tracker records but are hidden from the normal board. In Auto, a registered check advances Implementing to Verifying; qualifying functional proof advances to Ready to ship. These transitions require current live attempt provenance. Shipped retains release and before-close gates. Missing verification plans require worker assessment, not fabricated checks.
