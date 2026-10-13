---
name: start
description: Reconcile Cogumi Kanban progress.
---

First follow the setup-cogumi skill to resolve or create the repository-bound local project. Then read the cogumi-workflow skill. Kanban is tracking-only. Auto requires no tracker approvals. Read board_overview. Run cli update in the bound repository. Review actual implementation and record all affected stories with record_progress (stable event ID, worker, milestones, summaries and references). Never infer completion from commits alone or execute product checks on behalf of Kanban. In Approval present proposed reports first; approved:true requires exact user authorization. Open the UI with the open skill when requested.

Resolve the installed plugin root from PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT, otherwise the directory containing this skill; run sh <plugin root>/bin/kanban cli update. Never hardcode a cache version.
