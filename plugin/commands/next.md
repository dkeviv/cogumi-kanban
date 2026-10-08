---
description: Pick the next eligible Cogumi story and, if the user agrees, claim it before coding
---

Use the kanban MCP tools. Call `next_story` for the bound project (resolve it first if needed). For a strict project, make sure a `start_session` from the last 15 minutes exists for the current HEAD with a verified `pending_events` count, and call it again if not. Show the story's criteria, proof plan and dependencies. If the user wants to start it (or already said so: $ARGUMENTS), claim it with `claim_story` using the observed binding, `claude:<session id>` as worker, the current branch, the exact `git rev-parse HEAD` and a short acceptance plan, then write the reporter config described in the cogumi-workflow skill outside the product checkout.
