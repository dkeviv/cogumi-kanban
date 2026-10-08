// Identity adapter. Locally there is exactly one owner: the OS user running Claude Code.
// A hosted backend would replace this module with verified OAuth identities.
import os from 'node:os';
import type { Actor } from '../engine/engine.ts';

// All local records live in one board row; the row key is stable even if the OS
// username changes, while the actor ID recorded in audit history names the user.
export const BOARD_KEY = 'local';

export function ownerActor(): Actor {
    let user = 'owner';
    try { user = os.userInfo().username || user; } catch { /* userInfo can throw in sandboxes */ }
    return { id: `local:${user}`, role: 'owner' };
}

const idPattern = /^[A-Za-z0-9_.:-]{1,120}$/;

// Reporter scripts act for exactly one project/story/attempt. This prevents an
// over-broad or misconfigured script from touching other work; it is not a defence
// against a malicious process running as the same OS user (see PRD SEC 01).
export function reporterActor(scope: { project_id?: unknown; story_id?: unknown; attempt_id?: unknown }): Actor {
    for (const key of ['project_id', 'story_id', 'attempt_id'] as const)
        if (typeof scope[key] !== 'string' || !idPattern.test(scope[key] as string))
            throw Error(`Reporter scope requires a valid ${key}`);
    return { id: `reporter:${scope.attempt_id}`, role: 'reporter', project_id: scope.project_id as string, story_id: scope.story_id as string, attempt_id: scope.attempt_id as string };
}
