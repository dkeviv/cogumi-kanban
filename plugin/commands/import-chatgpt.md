---
description: Import a board exported from the ChatGPT edition of Cogumi Kanban
---

Import a Cogumi Kanban (ChatGPT Sites) export into the local tracker.

1. The export file path is: $ARGUMENTS. If none was given, explain how to produce one: in ChatGPT/Codex with the Cogumi Kanban plugin, ask "Call list_projects, then get_board for every project, and save the get_board results unmodified as one JSON array to a file", then download it. Stop there.
2. Run `sh "${CLAUDE_PLUGIN_ROOT}/bin/run-node.sh" "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" import "<file>"`. Add `--replace` only if the user explicitly asks to overwrite projects that were already imported.
3. Report the counts. Explain that every imported claim was expired, so in-progress work needs `reconcile` and `recover_claim` before continuing, and that each project needs `add_binding` with this repository's binding (from `workflow.mjs binding`) after the user confirms which project belongs to which repository.
