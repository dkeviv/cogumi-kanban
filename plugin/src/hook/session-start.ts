// SessionStart hook (PRD WRK 02, PRJ 01). When the working directory resolves to a
// bound project, give Claude the project, the session ID to use as thread_id, the
// script path and the outbox state, and remind it to reconcile before coding.
// Prints nothing for unbound directories so unrelated sessions stay quiet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KanbanService } from '../server/service.ts';
import { observeBinding } from '../server/binding.ts';
import { dataHome } from '../server/store.ts';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function countEvents(dir: string, projectId: string) {
    try {
        return fs.readdirSync(dir).filter(n => /^\d+-.+\.json$/.test(n)).filter(n => {
            try {
                // Outbox files are events; .rejected files wrap the event with its reason.
                const record = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
                return (record.event || record).args?.project_id === projectId;
            } catch { return false; }
        }).length;
    } catch { return 0; }
}

export async function sessionContext(input: { session_id?: string; cwd?: string }) {
    let binding: string;
    try { binding = observeBinding(input.cwd || process.cwd()).binding; } catch { return null; }
    if (!fs.existsSync(process.env.COGUMI_KANBAN_DB || path.join(dataHome(), 'kanban.db'))) return null;
    const service = new KanbanService();
    try {
        const projects = (await service.call('list_projects')).filter((p: any) => (p.bindings || [p.binding]).includes(binding));
        if (!projects.length) return null;
        if (projects.length > 1) return `Cogumi Kanban: binding ${binding} matches ${projects.length} projects; ask the user which project to use before any tracker mutation.`;
        const project = projects[0];
        const overview = await service.call('board_overview', { project_id: project.id });
        const issues = overview.tracking_health?.issues || [];
        const outbox = process.env.COGUMI_OUTBOX || path.join(dataHome(), 'outbox');
        const pending = countEvents(outbox, project.id), rejected = countEvents(path.join(outbox, '.rejected'), project.id);
        return [
            `Cogumi Kanban: this repository is bound to project "${project.name}" (project_id ${project.id}, binding ${binding}).`,
            `Claude session ID for thread_id: ${input.session_id || 'unavailable (use a labeled workspace session identifier)'}.`,
            `Plugin directory (<plugin> in the cogumi-workflow skill): ${pluginRoot}. Scripts: sh "${path.join(pluginRoot, 'bin', 'kanban')}" workflow binding|observe|resume|test|release|before-close CONFIG.`,
            `Outbox for this project: ${pending} pending, ${rejected} rejected event(s)${rejected ? ' — investigate rejected events before claiming work' : ''}.`,
            `Tracking warnings: ${issues.length}. ${issues.map((x: any) => x.story_id + ': ' + x.message).join(' ')}`,
            'Before coding: follow the cogumi-workflow skill — read board_overview, observe/resume, call start_session with the observed commit and the pending and rejected counts, and claim the story before editing code.',
        'Use the tracked workflow test runner for every proof check; it journals starts/results, renews active claims and queues delivery. Direct tests do not qualify completion. Run cli update at session start, before changing story, after a blocker and before reporting progress. Never hide an unknown outcome or renew an expired claim without reconciliation.',
        ].join('\n');
    } finally {
        service.close();
    }
}

export async function runHook(raw: string) {
    let input: any = {};
    try { input = raw ? JSON.parse(raw) : {}; } catch { /* hooks must never block a session */ }
    const context = await sessionContext(input);
    return context ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) : '';
}
