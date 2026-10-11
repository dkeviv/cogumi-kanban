---
name: update-kanban
description: Update, refresh, reconcile or audit the local Cogumi Kanban board on demand. Use when the user asks to update Kanban progress, synchronize the board, find missing evidence or inspect stale work.
---

Resolve this installed plugin directory from the skill location (two directories above this skill). Use its `bin/kanban` with `cli update` from the user's bound product repository. Read `../cogumi-workflow/SKILL.md` and follow `../../commands/update.md`. Do not use a hosted Cogumi connector for local records.

Save and summarize observed reconciliation, checkout dirtiness, missing proof scripts, pending/rejected delivery, expired claims and unknown results. Never convert chat test claims into passes. Do not silently renew an expired claim, replay another running worker, change source scope or claim completion. If the board is open, refresh it; otherwise start `cli board` persistently and open the actual returned URL with open_in_codex in Codex. Report unsupported host slash dispatch honestly; “Update Cogumi Kanban” invokes this skill without it.

Before executing command examples, replace `${CLAUDE_PLUGIN_ROOT}` with the resolved installed root. Do not assume Claude environment variables exist in Codex.
