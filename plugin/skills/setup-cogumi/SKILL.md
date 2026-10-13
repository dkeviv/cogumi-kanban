---
name: setup-cogumi
description: Set up or reconnect local Cogumi Kanban in Codex or Claude. Setup is included in this plugin; no separate setup plugin or cloud backend is needed.
---

# Set up Cogumi Kanban

Resolve the installed plugin root from PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT, otherwise two directories above this skill's directory. Never hardcode a cache version.

1. Run `sh <plugin root>/bin/kanban cli doctor`. It checks the runtime and opens the local tracker. Report failures honestly; preserve the existing database. No Sites, cloud account, or second plugin is required.
2. From the user's product repository run `sh <plugin root>/bin/kanban cli binding`. Use the observed binding with the kanban MCP `resolve_project` tool. Reuse the matching project. If ambiguous, let the user select. If no match exists, use `list_projects` to check whether an existing project should be associated via `add_binding`; do not guess or replace a board.
3. For a genuinely new project, use `create_project` with the observed binding, a user-provided project name (or the repository directory name), and a stable event ID. Creating tracking records does not authorize implementation or deployment. Do not seed sample stories.
4. Read `board_overview`, then run `sh <plugin root>/bin/kanban cli update` from the bound repository. Confirm only checks actually observed. If MCP tools are unavailable, explain that the host needs a new session after installation; do not report setup complete.
5. Follow the open skill to show the board when requested. Use the cogumi-workflow skill for progress tracking. Existing data remains local and is preserved across reinstallations.

For old cloud installations, use import-chatgpt only when the owner requests migration. This setup does not provision a Site or automatically copy cloud records.
