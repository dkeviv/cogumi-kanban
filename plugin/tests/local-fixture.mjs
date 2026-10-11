// Shared fixture: a real Git checkout, a real local SQLite tracker file and the real
// reporter scripts running as child processes against it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { KanbanService } from '../src/server/service.ts';

export const root = process.cwd();
export const ORIGIN = 'git@github.com:cogumi/integration.git';
export const BINDING = 'https://github.com/cogumi/integration';

export function invoke(script, args, cwd, env) {
    return new Promise(resolve => {
        const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, script), ...args], { cwd, env: { ...process.env, ...env } });
        let out = '', err = '';
        p.stdout.on('data', b => out += b);
        p.stderr.on('data', b => err += b);
        p.on('close', code => resolve({ code, out, err }));
    });
}

export async function makeRepo(dir, { origin = ORIGIN } = {}) {
    const repo = path.join(dir, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const git = (args, cwd = repo) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.test']);
    git(['config', 'user.name', 'Test']);
    if (origin) git(['remote', 'add', 'origin', origin]);
    await fs.writeFile(path.join(repo, 'source.txt'), 'A');
    git(['add', '.']);
    git(['commit', '-qm', 'initial']);
    return { repo, git, source: git(['rev-parse', 'HEAD']) };
}

export async function scenario({ strict = false } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-local-'));
    const { repo, git, source } = await makeRepo(dir);
    const home = path.join(dir, 'home');
    const fault = path.join(dir, 'fault.json');
    const env = { COGUMI_KANBAN_HOME: home, COGUMI_TEST_FAULT_FILE: fault, COGUMI_OUTBOX: path.join(dir, 'outbox'), COGUMI_RUNS: path.join(dir, 'runs') };
    const service = new KanbanService(path.join(home, 'kanban.db'));
    const p = await service.call('create_project', {delivery_mode:'approval', strict_checks: strict, name: 'Test', binding: BINDING, event_id: 'create' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { stories: [{ id: 'S', title: 'test', epic: 'E', criteria: ['command behavior'], proof_plan: [{ type: 'logic', expected: 'real command exits and output is captured' }] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'test authorization' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'approved' });
    const s = await go('claim_story', { worker: 'w', branch: 'main', starting_commit: source, plan: 'test command' });
    await go('set_commit', { worker: 'w', attempt_id: s.attempt_id, lease_token: s.claim.token, commit: source });
    await go('update_status', { worker: 'w', attempt_id: s.attempt_id, lease_token: s.claim.token, status: 'Verifying' });
    const cfg = path.join(dir, 'cfg.json');
    const configure = (command, extra = {}) => fs.writeFile(cfg, JSON.stringify({ project_id: p.id, binding: p.binding, story_id: 'S', attempt_id: s.attempt_id, environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, command, ...extra }));
    const setOutage = async actions => { if (actions) await fs.writeFile(fault, JSON.stringify(actions)); else await fs.rm(fault, { force: true }); };
    const story = async () => (await go('get_board')).stories[0];
    return {
        dir, repo, git, source, env, cfg, configure, go, story, project: p, claim: s, service,
        setOffline: v => setOutage(v ? ['record_evidence'] : null),
        setOfflineAll: v => setOutage(v ? ['*'] : null),
        cleanup: async () => { service.close(); await fs.rm(dir, { recursive: true, force: true }); },
    };
}
