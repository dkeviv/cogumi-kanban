---
name: worker
description: Inspect or stop a legacy worker.
---

Read the cogumi-workflow skill. Kanban is tracking-only. Auto requires no tracker approvals. Use cli worker status or stop; start and run are disabled. Never launch delivery agents or tests.

Resolve the installed plugin root from PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT, otherwise the directory containing this skill; run sh <plugin root>/bin/kanban cli update. Never hardcode a cache version.
