import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { observeBinding } from './binding.ts';
import { dataHome } from './store.ts';
import type { KanbanService } from './service.ts';

function eventsIn(dir: string, projectId: string) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const file of fs.readdirSync(dir).filter(n => /^\d+-.+\.json$/.test(n))) {
        // A malformed queue is a visible failure, never an assumed empty queue.
        const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if ((record.event || record).args?.project_id === projectId) count++;
    }
    return count;
}
export async function updateBoard(service: KanbanService, projectId?: string) {
    const observed = observeBinding();
    const projects = await service.call('list_projects');
    const matches = projects.filter((p: any) => (p.bindings || [p.binding]).includes(observed.binding) && (!projectId || p.id === projectId));
    if (matches.length !== 1) throw Error('Run update in the bound repository; select --project ID if its binding is ambiguous.');
    const project = matches[0];
    const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: observed.root, encoding: 'utf8' }); if (result.status !== 0) throw Error('Could not observe repository state'); return result.stdout.trim(); };
    const commit = git(['rev-parse', 'HEAD']);
    const dirty = !!git(['status', '--porcelain']);
    const outbox = process.env.COGUMI_OUTBOX || path.join(dataHome(), 'outbox');
    const pending = eventsIn(outbox, project.id), rejected = eventsIn(path.join(outbox, '.rejected'), project.id);
    const board = await service.call('get_board', { project_id: project.id });
    const missingChecks = board.stories.filter((s: any) => !['Draft', 'Backlog'].includes(s.status)).flatMap((s: any) => [...new Set(s.proof_plan.flatMap((p: any) => (p.checks || []).map((c: any) => c.command)))].flatMap((command: any) => {
        // Inspect explicit JS/TS check paths, never execute or guess arbitrary shell commands.
        const files = command.split(/\s+/).filter((v: string) => /\.(?:mjs|cjs|js|ts)$/.test(v) && !v.includes('*'));
        return files.filter((file: string) => !fs.existsSync(path.resolve(observed.root, file))).map((file: string) => ({ story_id: s.id, file, code: 'missing_check' }));
    }));
    const queue = board.workflow?.delivery_mode==='auto' ? await service.call('advance_queue',{project_id:project.id,event_id:crypto.randomUUID()}) : null;
    const reconciliation = await service.call('reconcile', { project_id: project.id, event_id: crypto.randomUUID(), commit, pending_events: pending });
    const overview = await service.call('board_overview', { project_id: project.id });
    const report = { project_id: project.id, binding: observed.binding, checked_at: new Date().toISOString(), delivery_mode:board.workflow?.delivery_mode||'auto', queue, checkout: { commit, dirty }, pending_events: pending, rejected_events: rejected, missing_checks: missingChecks, reconciliation_id: reconciliation.id, tracking_health: overview.tracking_health, status_counts: overview.stories.reduce((a: any, s: any) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {}) };
    const dir = path.join(dataHome(), 'updates'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `update-${project.id}.json`), temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
    return { ...report, report_path: file };
}
