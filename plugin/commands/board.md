---
description: Open the live local Cogumi Kanban board; automatically detect Codex or Claude
---

Choose the route from the tools actually available, rather than guessing the host from environment variables. This command is also available as `/cogumi-kanban:open`.

If `open_in_codex` is available (Codex), start `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" cli board` as a persistent process and open its actual returned URL with open_in_codex (browser target). Keep the process alive. This read-only board reads the local database and refreshes automatically; record rework in chat.

Otherwise, if a Claude Artifact publishing tool and this plugin’s local MCP tools are available (Claude Desktop), publish the live board:

1. Find the Cogumi tracker's MCP server name in your own tool list: take the tool named `mcp__<server>__board_overview` that has a sibling `mcp__<server>__story_detail`, and use the `<server>` segment (normally `plugin_cogumi-kanban_kanban`; `cogumi-kanban` if the owner registered the server in their own MCP configuration as the documented fallback). The Artifact host server is `host:<server>`, with any character outside `[A-Za-z0-9_-]` replaced by `_`.
2. Copy `${CLAUDE_PLUGIN_ROOT}/board/kanban-board.html` into your scratchpad directory as `cogumi-kanban-board.html` and replace the placeholder `__COGUMI_MCP_SERVER__` with that host server string. Change nothing else.
3. Publish it with the Artifact tool (`icon: "kanban"`, description "Live delivery board for Cogumi Kanban projects") and declare exactly these capabilities: `{"mcp": {"servers": [{"server": "host:<server>", "tools": ["list_projects", "board_overview", "story_detail", "request_rework"]}]}}`. If a board was published earlier in this conversation, republish the same file.
4. Tell the user in two or three sentences: the board reads their local tracker live only inside the Claude desktop app on this machine; the first load asks for permission; rework reports sent from the board go straight into the tracker; `/cogumi-kanban:snapshot` gives a static copy for anywhere else.

Otherwise (including Claude Code without Artifacts), start `sh "${CLAUDE_PLUGIN_ROOT}/bin/kanban" cli board` as a persistent background process, capture the actual URL printed by it, and open it with the host’s available browser tool or the operating system browser opener (`open` on macOS, `xdg-open` on Linux, `Start-Process` on Windows). Keep the server alive after the command finishes and show its URL. The local web route does not require MCP tool discovery. Never guess a port, publish the private URL externally, or fall back to a separately hosted board. If local process execution is unavailable, explain that limitation and offer the snapshot. $ARGUMENTS
