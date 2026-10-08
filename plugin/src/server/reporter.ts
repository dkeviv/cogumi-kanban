// Local reporter transport: replaces the ChatGPT edition's HTTPS /api/report endpoint
// and bearer credentials. Scripts call the engine directly as a scoped reporter actor.
import fs from 'node:fs';
import { KanbanService } from './service.ts';
import { reporterActor } from './identity.ts';
import { isTransient } from './store.ts';

export const REPORTER_ACTIONS = ['begin_run', 'record_evidence', 'record_release', 'checkpoint_attempt', 'restore_checkpoint', 'heartbeat_attempt'];

export type Scope = { project_id: string; story_id: string; attempt_id: string };

export class PermanentError extends Error { permanent = true; }

export function scopeOf(args: any): Partial<Scope> {
    return { project_id: args?.project_id, story_id: args?.story_id, attempt_id: args?.attempt_id || args?.evidence?.attempt_id };
}

let shared: KanbanService | null = null;
function service() { return shared ||= new KanbanService(); }
export function closeReporterService() { shared?.close(); shared = null; }

// Test-only outage simulation: when COGUMI_TEST_FAULT_FILE names an existing file
// holding a JSON array of action names (or "*"), those deliveries fail exactly like an
// unavailable database. Never set in normal use.
function simulatedOutage(action: string) {
    const file = process.env.COGUMI_TEST_FAULT_FILE;
    if (!file) return;
    let actions: unknown;
    try { actions = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (Array.isArray(actions) && (actions.includes('*') || actions.includes(action)))
        throw Object.assign(new Error('unable to open database file (simulated outage)'), { code: 'ERR_SQLITE_ERROR', errcode: 14 });
}

// Throws PermanentError for anything a retry cannot fix (validation, scope, engine
// rejection); transient storage failures are rethrown unchanged so callers retain the event.
export async function deliverAsReporter(action: string, args: any, scope: Partial<Scope> = scopeOf(args)) {
    if (!REPORTER_ACTIONS.includes(action)) throw new PermanentError(`Reporter action not permitted: ${action}`);
    simulatedOutage(action);
    let actor;
    try { actor = reporterActor(scope); } catch (e) { throw new PermanentError((e as Error).message); }
    try {
        const project = await service().call('get_board', { project_id: actor.project_id });
        const story = project.stories.find((s: any) => s.id === actor.story_id);
        if (!story) throw new PermanentError('Reporter story not found');
        if (!(story.attempts || []).some((a: any) => a.id === actor.attempt_id))
            throw new PermanentError('Reporter attempt does not exist on this story');
        return await service().call(action, args, actor);
    } catch (e) {
        if (e instanceof PermanentError || isTransient(e)) throw e;
        throw new PermanentError((e as Error).message);
    }
}
