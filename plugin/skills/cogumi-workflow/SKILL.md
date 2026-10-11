---
name: cogumi-workflow
description: Track implementation milestones and epic coverage with Cogumi Kanban, without executing product work.
---

Use the kanban MCP server. Read its workflow tool for the current contract. Kanban is tracking-only and never runs tests or starts delivery agents.

Default Auto applies routine tracker decisions without approval. Approval mode presents proposed updates and requires approval for the exact report; reuse existing user authorization. Goals do not select modes.

At session start read board_overview and run update-kanban. At implementation, verification, release, blocker and final-response checkpoints call record_progress once for all affected stories, with stable event ID, worker identity, milestone, summary and actual references. Retry the identical event on delivery failure. Do not claim leases, prepare proof plans or run tracker-owned tests for this workflow.

Only report achieved criteria. Commits alone are insufficient. Milestones are reported by the coding agent, distinct from independent proof. Use rework to withdraw incorrect completion. Respect other live workers. Auto advances assessed stories to Ready when criteria exist and dependencies are implemented, retaining unresolved scope in Draft.

Use /cogumi-kanban:update-kanban to reconcile missing/stale reports and /cogumi-kanban:open to show the board. Codex requires explicit skill invocation at new session start; Claude has a session reminder. Tracking warnings never block implementation.

For durable CLI delivery use sh <installed plugin root>/bin/kanban cli progress --file REPORT.json. The report contains project_id, stable event_id, worker and reports. The update command replays pending progress reports. Resolve the installed plugin root from this skill location rather than hardcoding a version.
