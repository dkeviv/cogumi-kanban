// Regression tests for the first code review of the Claude edition.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { scenario, invoke, makeRepo, BINDING } from './local-fixture.mjs';
import { KanbanService } from '../src/server/service.ts';
import { isTransient } from '../src/server/store.ts';
import { normalizeOrigin } from '../src/server/binding.ts';
import { parseExport } from '../src/server/migrate.ts';
import { A } from './helpers.mjs';

test('a rejected result is recorded as blocked, never resent on resume, and before-close exits 3', async () => {
    const f = await scenario();
    try {
        const assertion_file = path.join(f.dir, 'assertions.json');
        // Duplicate assertion outcomes are refused by the engine: a permanent rejection.
        const code = `require('fs').writeFileSync(process.env.COGUMI_ASSERTION_FILE, JSON.stringify([{check_id:'c',name:'n',result:'pass'},{check_id:'c',name:'n',result:'pass'}]))`;
        await f.configure([process.execPath, '-e', code], { assertion_file });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 2, r.err);
        assert.match(r.err, /Rejected/);
        let s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.evidence[0].result, 'blocked');
        assert.match(s.evidence[0].error, /rejected by the tracker/);
        assert.equal(s.eligibility.functional, false);
        const resumed = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(resumed.code, 0, resumed.err + resumed.out); // already resolved: nothing new rejected
        const top = async () => (await fs.readdir(path.join(f.env.COGUMI_OUTBOX, '.rejected'))).filter(n => n.endsWith('.json'));
        // The run already has its (blocked) result, so the rejection is settled as history.
        assert.equal((await top()).length, 0, 'never re-enqueued, and filed away once resolved');
        assert.equal((await fs.readdir(path.join(f.env.COGUMI_OUTBOX, '.rejected', 'resolved'))).length, 1);
        const closing = await invoke('scripts/workflow.mjs', ['before-close', f.cfg], f.repo, f.env);
        assert.equal(closing.code, 0, closing.err);
        s = await f.story();
        assert.equal(s.evidence.length, 1);
    } finally { await f.cleanup(); }
});

test('a checkpoint failure never stops the evidence from being delivered', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(path.join(f.dir, 'fault.json'))}, JSON.stringify(['checkpoint_attempt']));console.log('done')`]);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.match(r.err, /Checkpoint not saved/);
        const s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.evidence[0].result, 'pass');
    } finally { await f.cleanup(); }
});

test('a wrong data root retains events instead of rejecting them, and never creates a database', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const wrong = path.join(f.dir, 'elsewhere');
        const env = { ...f.env, COGUMI_KANBAN_HOME: wrong };
        const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/report.mjs', 'heartbeat_attempt'], { env: { ...process.env, ...env } });
        let err = '';
        p.stderr.on('data', d => err += d);
        p.stdin.end(JSON.stringify({ project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'kept' }));
        const code = await new Promise(r => p.on('close', r));
        assert.equal(code, 2);
        assert.match(err, /Retained kept: Tracker database not found/);
        await assert.rejects(fs.access(path.join(wrong, 'kanban.db')));
        await assert.rejects(fs.access(path.join(f.env.COGUMI_OUTBOX, '.rejected')));
        const ok = await invoke('scripts/report.mjs', ['flush'], f.repo, f.env);
        assert.equal(ok.code, 0, ok.err);
        assert.match(ok.out, /Delivered kept/);
    } finally { await f.cleanup(); }
});

test('requeue moves a rejected event back after the cause is fixed', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const outbox = f.env.COGUMI_OUTBOX;
        await fs.mkdir(path.join(outbox, '.rejected'), { recursive: true });
        const event = { sequence: 7, action: 'heartbeat_attempt', args: { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'again' } };
        await fs.writeFile(path.join(outbox, '.rejected', '000000000007-again.json'), JSON.stringify({ event, error: 'was broken', rejected_at: new Date().toISOString() }));
        const r = await invoke('scripts/report.mjs', ['requeue', 'again'], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /Requeued again/);
        assert.match(r.out, /Delivered again/);
        assert.deepEqual(await fs.readdir(path.join(outbox, '.rejected')), []);
    } finally { await f.cleanup(); }
});

test('credentials sent straight through MCP tools are redacted before storage and in views', async () => {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', {delivery_mode:'approval', strict_checks: false, name: 'R', binding: 'https://e.test/r', event_id: 'c' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { source: 'P', source_revision: '1', stories: [{ id: 'S', title: 't', epic: 'E', criteria: ['x'], proof_plan: [{ type: 'logic', expected: 'x' }] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    const c = await go('claim_story', { worker: 'w', branch: 'b', starting_commit: A, plan: 'p' });
    const lease = { worker: 'w', attempt_id: c.attempt_id, lease_token: c.claim.token };
    await go('set_commit', { ...lease, commit: A });
    const run = await go('begin_run', { ...lease, kind: 'functional', commit: A, command: 'curl -H "Authorization: Bearer abcdefgh12345678" x', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false });
    await go('record_evidence', { evidence: { run_id: run.id, attempt_id: c.attempt_id, criterion_revision: run.criterion_revision, commit: A, end_commit: A, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: 'token ghp_abcdefghijklmnopqrstuvwxyz0123 leaked' } });
    const raw = JSON.stringify(await go('get_board'));
    assert.doesNotMatch(raw, /ghp_abcdefghij|abcdefgh12345678/);
    const d = await service.call('story_detail', { project_id: p.id, story_id: 'S' });
    assert.match(d.evidence[0].output, /\[redacted\]/);
    assert.match(d.runs[0].command, /\[redacted\]/);
    service.close();
});

test('MCP stdio answers oversized, unterminated and null-id requests correctly', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-rpc-'));
    try {
        const child = spawn('sh', ['bin/run-node.sh', 'dist/server.mjs'], { env: { ...process.env, COGUMI_KANBAN_HOME: home } });
        let out = '';
        child.stdout.on('data', d => out += d);
        const big = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_projects', arguments: { pad: 'x'.repeat(4_500_000) } } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
        for (let i = 0; i < big.length; i += 65536) child.stdin.write(big.slice(i, i + 65536));
        child.stdin.write('\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }) + '\n');
        child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' })); // no trailing newline
        await new Promise(r => child.on('close', r));
        const replies = out.trim().split('\n').map(l => JSON.parse(l));
        assert.deepEqual(replies.map(r => r.id), [1, 7, null, 9]);
        assert.match(replies[1].error.message, /larger than/);
        assert.equal(replies[2].error.code, -32600);
        assert.deepEqual(replies[3].result, {});
    } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('import validation, binding normalization edge cases and error classification', () => {
    assert.throws(() => parseExport([{ id: '../../tmp/x', stories: [], binding: 'b' }]), /not a valid identifier/);
    assert.throws(() => parseExport([{ id: 'a', stories: [], binding: 'same' }, { id: 'b', stories: [], bindings: ['same'] }]), /share binding/);
    assert.equal(normalizeOrigin('git@host.test:/owner/repo.git'), 'https://host.test/owner/repo');
    assert.equal(normalizeOrigin('https://host.test:8443/a/b.git'), 'https://host.test:8443/a/b');
    assert.notEqual(normalizeOrigin('https://host.test:8443/a/b'), normalizeOrigin('https://host.test/a/b'));
    assert.equal(isTransient(Object.assign(new Error('denied'), { code: 'EACCES' })), false);
    assert.equal(isTransient(Object.assign(new Error('gone'), { code: 'COGUMI_UNAVAILABLE' })), true);
    assert.equal(isTransient(Object.assign(new Error('ro'), { errcode: 264 })), true);
});

test('hook still runs when the plugin path goes through a symlink', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-link-'));
    try {
        const { repo } = await makeRepo(dir);
        const link = path.join(dir, 'plugin-link');
        await fs.symlink(process.cwd(), link);
        const service = new KanbanService(path.join(dir, 'home', 'kanban.db'));
        await service.call('create_project', {delivery_mode:'approval', name: 'Linked', binding: BINDING, event_id: 'c' });
        service.close();
        const out = await new Promise(resolve => {
            const p = spawn('sh', [path.join(link, 'bin/run-node.sh'), path.join(link, 'dist/hook.mjs')], { env: { ...process.env, COGUMI_KANBAN_HOME: path.join(dir, 'home'), CLAUDE_PLUGIN_ROOT: link } });
            let o = '';
            p.stdout.on('data', d => o += d);
            p.on('close', () => resolve(o));
            p.stdin.end(JSON.stringify({ session_id: 's', cwd: repo }));
        });
        assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /Linked/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
