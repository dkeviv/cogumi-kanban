---
name: open
description: Open or show the local Cogumi Kanban UI or board. Use when the user requests the board, /cogumi-kanban:open or /cogumi-kanban:board. Auto-detect Codex and Claude from available capabilities.
---

Resolve the installed plugin root from this skill location (two directories above). Read `../../commands/board.md` and execute its host detection and opening instructions using that root. Do not switch to a hosted connector. Prefer open_in_codex when available; otherwise a supported Claude Artifact; otherwise a persistent local board server and the available browser opener. Keep the server alive. Report inability to execute local processes honestly. Opening a board needs no owner operation or claim recovery.

Before executing command examples, replace `${CLAUDE_PLUGIN_ROOT}` with the resolved installed root. Do not assume Claude environment variables exist in Codex.
