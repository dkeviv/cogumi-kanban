---
description: Write a static HTML snapshot of the Cogumi Kanban board to a local file
---

Run `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" cli snapshot $ARGUMENTS` from the current directory (add `--project <id>` if it asks for one; `--out <file>` chooses the path). Report the file path it wrote. Do not publish the snapshot as an Artifact unless the user explicitly asks, because that copies tracker records off this machine. If the user is in the Claude desktop app, offer to open the file in the browser pane.
