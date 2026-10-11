---
description: Select Auto or Approval mode for Cogumi Kanban delivery
---

The user selects `auto` or `approval` in $ARGUMENTS. Resolve the bound product repository and run `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" cli mode auto --reason "User selected Auto mode for existing approved scope"` (substitute approval when selected). If mode is missing, inspect current project mode and ask which mode the user wants. Preserve phase/environment scope; never authorize new phases. Report actual prepared/waiting queue. Read `${CLAUDE_PLUGIN_ROOT}/skills/cogumi-workflow/SKILL.md` and continue eligible approved delivery in Auto when implementation is the user's current task. Selecting mode itself does not start an independent worker or take over another worker's active claims.
