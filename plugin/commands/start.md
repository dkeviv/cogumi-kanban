---
description: Resolve this repository's Cogumi project, reconcile pending reports and show the next eligible story
---

Follow the cogumi-workflow skill, sections 1 and 2, for the current working directory:

1. Run `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" workflow binding` and resolve the project with the kanban MCP tool `resolve_project`. If nothing matches, show `list_projects` and ask whether to create a project or add this binding to an existing one. Do not guess.
2. If a reporter config exists for an active attempt, run `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" workflow observe CONFIG` and then `... workflow resume CONFIG`. Report pending and rejected events honestly.
3. Call `start_session` with this session's ID as thread_id, the observed binding and commit, and the verified pending count.
4. Show `board_overview` as a short summary (counts per state, blocked and rework items, epic progress), then `next_story`.

Do not claim or change anything else unless the user asks. $ARGUMENTS
