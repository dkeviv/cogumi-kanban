---
description: Update the local Cogumi Kanban board from repository observations and recorded evidence
---

Run `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" cli update` from the bound product repository. If binding is ambiguous, select the verified project with `--project ID`; never select by title. This saves a reconciliation and private update report, repairs invalid completion through existing engine gates, and reports expired claims, missing/unknown/dirty evidence, pending/rejected reports, dirty checkout and missing check files. Summarize actual progress and gaps. Refresh the open board, or start `cli board` and open its observed URL in Codex.

Do not fabricate passes from chat or direct tests. Do not automatically replay a running worker's reports, recover expired claims, classify source requirements or claim completion. For an interrupted attempt, inspect its CONFIG using workflow observe; verify the previous worker has stopped before resume. Register and run required checks through workflow test CONFIG, preserving real assertions, exact candidate commit and original results. Record a confirmed blocker with update_status Blocked and its reason, next_action and dependency, using the active lease. Scope changes and claim recovery follow their owner requirements. If the user only asked to refresh, stop after reporting the reconciliation.

Command: `/cogumi-kanban:update`. In hosts without slash-command dispatch, the same skill request is “Update Cogumi Kanban”; run the CLI and show the actual report. Never claim the host registered a slash command without observing it.
