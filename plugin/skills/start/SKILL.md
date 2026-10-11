---
name: start
description: Resolve this repository's Cogumi project, reconcile pending reports and show the next eligible story
---

Resolve this installed plugin root from this skill location (two directories above). Read `../../commands/start.md` and execute it. Replace every `${CLAUDE_PLUGIN_ROOT}` example with that resolved absolute root before running it; do not assume Claude environment variables exist. Detect host capabilities from available tools. Read `../cogumi-workflow/SKILL.md` when requested by that command. Use this host's real session identity for worker/thread IDs and the local tracker, preserving the project's approved scope and mode.
