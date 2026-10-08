// Tests added by the requirements coverage review (PRD v2.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fixture, A, B } from './helpers.mjs';
import { boardOverview } from '../src/server/views.ts';
import { scenario, invoke } from './local-fixture.mjs';

test('closed rework no longer counts as open; reopened shipped work withdraws completion (REW 01, scenario 15)', () => {
    const f = fixture();
    f.start(); f.ship();
    assert.equal(f.s.status, 'Shipped');
    f.go('request_rework', { reason: 'Profile not kept', observed: 'lost', expected: 'kept', classification: 'unmet' });
    let card = boardOverview(f.p).stories.find(s => s.id === 'S1');
    assert.equal(card.status, 'Needs rework');
    assert.equal(card.open_rework, 1);
    assert.equal(card.eligibility.deployed, false);
    assert.equal(boardOverview(f.p).summary.epics[0].complete, false);
    // Corrective attempt: reproduce, fix on a new commit, verify, release, ship.
    const report = f.s.rework.at(-1);
    f.go('record_reproduction', { report_id: report.id, method: 'manual', result: 'fail', details: 'Reloaded and the profile was gone' });
    f.go('update_status', { status: 'Backlog' });
    f.go('update_status', { status: 'Ready', reason: 'corrective work approved' });
    const c = f.go('claim_story', { worker: 'worker', branch: 'fix', starting_commit: A, plan: 'fix persistence' });
    const lease = { worker: 'worker', attempt_id: c.attempt_id, lease_token: c.claim.token };
    f.go('set_commit', { ...lease, commit: B });
    f.go('update_status', { ...lease, status: 'Verifying' });
    const run = f.go('begin_run', { ...lease, kind: 'functional', commit: B, command: 'node test', environment: 'local', criteria: [0, 1], verification_types: ['api', 'integration'], mocked: false, dirty: false });
    f.go('record_evidence', { evidence: { run_id: run.id, attempt_id: run.attempt_id, criterion_revision: run.criterion_revision, commit: B, end_commit: B, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: 'ok' } });
    f.go('update_status', { ...lease, status: 'Ready to ship' });
    f.go('record_release', { ...lease, release: { commit: B, version: 'v2', url: 'https://example.test', environment: 'production', result: 'succeeded' } });
    const dep = f.go('begin_run', { ...lease, kind: 'deployed', commit: B, command: 'node deployed', environment: 'production', criteria: [0, 1], verification_types: ['api', 'integration'], mocked: false, dirty: false, release_version: 'v2' });
    f.go('record_evidence', { evidence: { run_id: dep.id, attempt_id: dep.attempt_id, criterion_revision: dep.criterion_revision, commit: B, end_commit: B, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: 'ok' } });
    f.go('update_status', { ...lease, status: 'Shipped' });
    card = boardOverview(f.p).stories.find(s => s.id === 'S1');
    assert.equal(card.status, 'Shipped');
    assert.equal(card.open_rework, 0, 'a closed report must not keep the rework chip');
});

test('preview_import writes nothing and reports added/changed/retained (BKL 01)', () => {
    const f = fixture();
    const before = JSON.stringify(f.p.stories);
    const preview = f.go('preview_import', { stories: [{ id: 'S1', epic: 'E1', title: 'Persist v2', criteria: ['saved', 'isolated'] }, { id: 'S9', epic: 'E2', title: 'New', criteria: ['x'] }] });
    assert.deepEqual(preview.added, ['S9']);
    assert.deepEqual(preview.changed, ['S1']);
    assert.deepEqual(preview.retained, ['S2']);
    assert.equal(JSON.stringify(f.p.stories), before);
});

test('an explicitly excluded requirement stops blocking coverage and is listed separately (COV 01)', () => {
    const f = fixture();
    f.go('set_requirements', { source: 'PRD', source_revision: '2', requirements: [{ id: 'R1', epic: 'E1', phase: 'MVP', stories: ['S1'] }, { id: 'R2', epic: 'E1', phase: 'MVP', stories: ['S2'] }, { id: 'R3', epic: 'E1', phase: 'MVP', stories: [], text: 'Audit export' }] });
    let ov = boardOverview(f.p);
    assert.deepEqual(ov.coverage.unmapped.map(r => r.id), ['R3']);
    assert.equal(ov.coverage.unmapped[0].text, 'Audit export');
    assert.equal(ov.coverage.unmapped[0].source_revision, '2');
    assert.deepEqual(ov.coverage.source, { source: 'PRD', revision: '2' });
    f.go('exclude_requirement', { requirement_id: 'R3', reason: 'Owner deferred audit export to Next' });
    ov = boardOverview(f.p);
    assert.deepEqual(ov.coverage.unmapped, []);
    assert.equal(ov.coverage.excluded[0].reason, 'Owner deferred audit export to Next');
    assert.deepEqual(ov.summary.unmapped, []);
});

test('start_session reports unfinished runs and known releases; reconcile records repairs and conflicts (REL 02, REC 01)', () => {
    const f = fixture();
    f.start(); f.ship();
    const pending = f.begin(); // registered, never reported
    const session = f.go('start_session', { thread_id: 'claude-session-1', binding: f.p.binding, commit: A, pending_events: 0 });
    assert.ok(session.unfinished_runs.some(r => r.run_id === pending.id));
    assert.ok(session.known_releases.some(r => r.version === 'v1' && r.result === 'succeeded'));
    // A newer failing run withdraws shipped status immediately.
    f.evidence(pending, { result: 'fail', exit_code: 1, error: 'regressed' });
    assert.equal(f.s.status, 'Needs rework');
    // A stored status that no longer matches its proof (for example in an imported
    // board) is repaired by reconcile and the repair is recorded.
    f.s.status = 'Shipped';
    const r1 = f.go('reconcile', {});
    assert.deepEqual(r1.repairs, [{ story: 'S1', previous: 'Shipped', status: 'Needs rework' }]);
    assert.equal(f.s.history.at(-1).action, 'reconcile_repair');
    // A claim whose candidate commit differs from the observed checkout is a conflict.
    const g = fixture();
    g.start();
    const r2 = g.go('reconcile', { commit: B, pending_events: 0 });
    assert.ok(r2.conflicts.length >= 1);
});

test('failed and successful releases through the workflow release command (SHP 02, scenario 8)', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('functional ok')"]);
        assert.equal((await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env)).code, 0);
        const lease = { worker: 'w', attempt_id: f.claim.attempt_id, lease_token: f.claim.claim.token };
        await f.go('update_status', { ...lease, status: 'Ready to ship' });
        const provider = path.join(f.dir, 'provider.json');
        const write = extra => fs.writeFile(provider, JSON.stringify({ provider: 'test-host', deployment_id: 'dep-1', version_id: 'v1', commit_sha: f.source, status: 'failed', url: 'https://app.example.test', ...extra }));
        // Contract violations are refused before anything is recorded.
        for (const [extra, message] of [[{ url: 'http://app.example.test' }, /HTTPS/], [{ commit_sha: 'b'.repeat(40) }, /exact source/], [{ environment: 'production' }, /contradicts/]]) {
            await write(extra);
            const r = await invoke('scripts/workflow.mjs', ['release', f.cfg, provider], f.repo, f.env);
            assert.equal(r.code, 2);
            assert.match(r.err, message);
        }
        await write({});
        let r = await invoke('scripts/workflow.mjs', ['release', f.cfg, provider], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        let s = await f.story();
        assert.equal(s.status, 'Ready to ship', 'a failed deployment never ships');
        await assert.rejects(f.go('update_status', { ...lease, status: 'Shipped' }));
        await write({ deployment_id: 'dep-2', version_id: 'v2', status: 'succeeded' });
        r = await invoke('scripts/workflow.mjs', ['release', f.cfg, provider], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        await assert.rejects(f.go('update_status', { ...lease, status: 'Shipped' }), /deployed|proof|release/i, 'deployed checks are still missing');
        await f.configure([process.execPath, '-e', "if(process.env.COGUMI_TARGET_URL!=='https://app.example.test')process.exit(1);console.log('deployed ok')"], { kind: 'deployed', release_version: 'v2', target_url: 'https://app.example.test' });
        r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.equal((await invoke('scripts/workflow.mjs', ['before-close', f.cfg], f.repo, f.env)).code, 0);
        await f.go('update_status', { ...lease, status: 'Shipped' });
        s = await f.story();
        assert.equal(s.status, 'Shipped');
        assert.equal(s.eligibility.deployed, true);
        // A dirty checkout cannot record a release.
        await fs.writeFile(path.join(f.repo, 'source.txt'), 'dirty');
        r = await invoke('scripts/workflow.mjs', ['release', f.cfg, provider], f.repo, f.env);
        assert.equal(r.code, 2);
        assert.match(r.err, /Commit source/);
    } finally { await f.cleanup(); }
});

test('wrapper records an https artifact reference and refuses other forms (TST 01)', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('ok')"], { artifact: 'https://ci.example.test/runs/42/trace.zip' });
        assert.equal((await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env)).code, 0);
        assert.equal((await f.story()).evidence[0].artifact, 'https://ci.example.test/runs/42/trace.zip');
        await f.configure([process.execPath, '-e', "console.log('ok')"], { artifact: '/tmp/trace.zip' });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 2);
        assert.match(r.err, /artifact must be an https/);
    } finally { await f.cleanup(); }
});

test('reporter files are owner-only even under a permissive umask (SEC 01)', async () => {
    const f = await scenario();
    try {
        delete f.env.COGUMI_OUTBOX; delete f.env.COGUMI_RUNS;
        await f.configure([process.execPath, '-e', "console.log('ok')"]);
        // Run from the checkout (binding check) with a group/world-readable umask.
        const r2 = spawnSync('/bin/sh', ['-c', `umask 022; cd "${f.repo}" && exec "${process.execPath}" --disable-warning=ExperimentalWarning "${path.resolve('scripts/test-and-report.mjs')}" "${f.cfg}"`], { env: { ...process.env, ...f.env }, encoding: 'utf8' });
        assert.equal(r2.status, 0, r2.stderr);
        const loose = [];
        const walk = async dir => {
            for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if ((await fs.stat(full)).mode & 0o077) loose.push(full);
                if (entry.isDirectory()) await walk(full);
            }
        };
        await walk(f.env.COGUMI_KANBAN_HOME);
        assert.deepEqual(loose, []);
    } finally { await f.cleanup(); }
});

test('launcher discovers an nvm install when PATH has no node (PLG 01)', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk home '));
    try {
        const bin = path.join(home, '.nvm', 'versions', 'node', 'v26.0.0', 'bin');
        await fs.mkdir(bin, { recursive: true });
        await fs.symlink(process.execPath, path.join(bin, 'node'));
        const r = spawnSync('/bin/sh', [path.resolve('bin/run-node.sh'), '-e', 'console.log(process.argv0)'], { env: { PATH: '/nonexistent', HOME: home }, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.ok(r.stdout.trim().length > 0);
        const viaWrapper = spawnSync('/bin/sh', [path.resolve('bin/kanban'), 'nope'], { encoding: 'utf8' });
        assert.equal(viaWrapper.status, 2);
        assert.match(viaWrapper.stderr, /workflow\|report\|cli\|openspec/);
    } finally { await fs.rm(home, { recursive: true, force: true }); }
});
