---
description: Publish the live Cogumi Kanban board as a Claude Artifact
---

Publish the live board:

1. Find the Cogumi tracker's MCP server name in your own tool list: take the tool named `mcp__<server>__board_overview` that has a sibling `mcp__<server>__story_detail`, and use the `<server>` segment (normally `plugin_cogumi-claude-kanban_kanban`; `cogumi-kanban` if the owner registered the server in their own MCP configuration as the documented fallback). The Artifact host server is `host:<server>`, with any character outside `[A-Za-z0-9_-]` replaced by `_`.
2. Copy `${CLAUDE_PLUGIN_ROOT}/board/kanban-board.html` into your scratchpad directory as `cogumi-kanban-board.html` and replace the placeholder `__COGUMI_MCP_SERVER__` with that host server string. Change nothing else.
3. Publish it with the Artifact tool (`icon: "kanban"`, description "Live delivery board for Cogumi Claude Kanban projects") and declare exactly these capabilities: `{"mcp": {"servers": [{"server": "host:<server>", "tools": ["list_projects", "board_overview", "story_detail", "request_rework"]}]}}`. If a board was published earlier in this conversation, republish the same file.
4. Tell the user in two or three sentences: the board reads their local tracker live only inside the Claude desktop app on this machine; the first load asks for permission; rework reports sent from the board go straight into the tracker; `/cogumi-claude-kanban:snapshot` gives a static copy for anywhere else.

If no `board_overview` tool from this plugin is in your tool list, say that the plugin's MCP server is not running, suggest `/mcp` to check it and offer the snapshot instead. $ARGUMENTS
