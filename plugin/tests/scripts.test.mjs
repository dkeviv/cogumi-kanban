// Outbox ordering and acknowledgment (ported from the ChatGPT edition's B10/B11 tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scenario, invoke } from './local-fixture.mjs';

test('B10: a transient outage keeps events in producer order and sends nothing after the first failure', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const hb = id => ({ project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: id });
        await f.setOfflineAll(true);
        for (const id of ['z-first', 'a-second']) {
            await new Promise(resolve => { const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/report.mjs', 'heartbeat_attempt'], { env: { ...process.env, ...f.env } }); p.on('close', resolve); p.stdin.end(JSON.stringify(hb(id))); });
        }
        const files = (await fs.readdir(f.env.COGUMI_OUTBOX)).filter(n => /^\d+-.+\.json$/.test(n)).sort();
        assert.deepEqual(files.map(n => n.replace(/^\d+-/, '')), ['z-first.json', 'a-second.json']);
        const failed = await invoke('scripts/report.mjs', ['flush'], f.repo, f.env);
        assert.equal(failed.code, 2);
        assert.match(failed.err, /Retained z-first/);
        assert.match(await fs.readFile(path.join(f.env.COGUMI_OUTBOX, '.last-failure'), 'utf8'), /z-first/);
        await f.setOfflineAll(false);
        const ok = await invoke('scripts/report.mjs', ['flush'], f.repo, f.env);
        assert.equal(ok.code, 0, ok.err);
        assert.deepEqual(ok.out.trim().split('\n'), ['Delivered z-first', 'Delivered a-second']);
        await assert.rejects(fs.access(path.join(f.env.COGUMI_OUTBOX, '.last-failure')));
    } finally { await f.cleanup(); }
});

test('B11/B17: silent success is delivered with empty output; spawn failure never exits success', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', 'process.exit(0)']);
        let r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.equal((await f.story()).evidence.at(-1).output, '');
        await f.configure(['/definitely-no-such-command']);
        r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.notEqual(r.code, 0);
        assert.ok((await f.story()).evidence.at(-1).error);
    } finally { await f.cleanup(); }
});

test('report acknowledgment survives another process flushing first', async () => {
    const f = await scenario();
    const old = { ...process.env };
    try {
        Object.assign(process.env, f.env);
        const { enqueue, flush, send } = await import('../scripts/reporting.mjs');
        const s = await f.story();
        const args = { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'same', binding: f.project.binding, kind: 'functional', commit: f.source, command: 'node x', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false };
        await enqueue('begin_run', args);
        await flush();
        const run = await send('begin_run', args);
        assert.ok(run.id);
        assert.equal((await f.story()).runs.length, 1, 'registered exactly once');
    } finally { process.env = old; await f.cleanup(); }
});

test('reporter configuration with a mismatched binding never runs the command', async () => {
    const f = await scenario();
    try {
        const marker = path.join(f.dir, 'ran');
        await f.configure([process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'1')`], { binding: 'https://github.com/someone/else' });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 4);
        assert.match(r.err, /binding mismatch/);
        assert.match(r.err, /command was not run/);
        await assert.rejects(fs.access(marker));
        assert.equal((await f.story()).runs.length, 0);
    } finally { await f.cleanup(); }
});
