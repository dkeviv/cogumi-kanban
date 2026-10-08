// End-to-end reporter workflow against the local SQLite tracker. The first group is
// ported from the ChatGPT edition's workflow-http tests (an HTTP outage becomes an
// unavailable database); the second covers Claude-edition PRD scenarios 18–21.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scenario, invoke, root } from './local-fixture.mjs';

test('B07 real command changing source cannot qualify proof', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "const fs=require('fs'),cp=require('child_process');console.log('tested A');fs.writeFileSync('source.txt','B');cp.execFileSync('git',['add','source.txt']);cp.execFileSync('git',['commit','-qm','change']);"]);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.notEqual(r.code, 0);
        const s = await f.story();
        assert.equal(s.evidence[0].commit, f.source);
        assert.notEqual(s.evidence[0].end_commit, f.source);
        assert.equal(s.evidence[0].dirty, true);
        assert.equal(s.eligibility.functional, false);
    } finally { await f.cleanup(); }
});

test('database outage replay saves exactly one run result (scenario 5)', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('real functional result')"]);
        await f.setOffline(true);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 2, r.err);
        let s = await f.story();
        assert.equal(s.runs.length, 1);
        assert.equal(s.evidence.length, 0);
        await f.setOffline(false);
        assert.equal((await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env)).code, 0);
        assert.equal((await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env)).code, 0);
        s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.evidence[0].output, 'real functional result\n');
        assert.equal(s.eligibility.functional, true);
    } finally { await f.cleanup(); }
});

test('command terminated by signal records failure and exits nonzero', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "process.kill(process.pid,'SIGTERM')"]);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.notEqual(r.code, 0);
        const s = await f.story();
        assert.equal(s.evidence[0].signal, 'SIGTERM');
        assert.equal(s.evidence[0].result, 'fail');
    } finally { await f.cleanup(); }
});

test('database checkpoint restores a pending result after the local outbox and run logs are destroyed', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('durable executed assertion')"]);
        await f.setOffline(true);
        assert.equal((await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env)).code, 2);
        await fs.rm(f.env.COGUMI_OUTBOX, { recursive: true });
        await fs.rm(f.env.COGUMI_RUNS, { recursive: true });
        await f.setOffline(false);
        const restored = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(restored.code, 0, restored.err);
        const s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.evidence[0].output, 'durable executed assertion\n');
        assert.equal(s.report_health.pending_events, 0);
        assert.equal(s.eligibility.functional, true);
    } finally { await f.cleanup(); }
});

test('killed wrapper recovers unfinished registered run as blocked, never pass (scenario 7)', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "setTimeout(()=>console.log('unreported'),1500)"]);
        const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'scripts/test-and-report.mjs'), f.cfg], { cwd: f.repo, env: { ...process.env, ...f.env } });
        const ended = new Promise(resolve => child.on('close', resolve));
        let started = false;
        for (let i = 0; i < 200; i++) {
            const s = await f.story();
            if (s.checkpoints?.[0]?.journals.some(j => j.state === 'started')) { started = true; break; }
            await new Promise(r => setTimeout(r, 10));
        }
        assert.ok(started, 'run must checkpoint before execution');
        child.kill('SIGKILL');
        await ended;
        const r = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        const s = await f.story();
        assert.equal(s.evidence[0].result, 'blocked');
        assert.equal(s.evidence[0].exit_code, null);
        assert.equal(s.eligibility.functional, false);
    } finally { await f.cleanup(); }
});

test('previous assertion artifact cannot satisfy a new command that produced no assertion output', async () => {
    const f = await scenario();
    try {
        const assertion_file = path.join(f.dir, 'assertions.json');
        await fs.writeFile(assertion_file, JSON.stringify([{ check_id: 'saved', name: 'saved row', result: 'pass' }]));
        await f.configure([process.execPath, '-e', 'process.exit(0)'], { assertion_file });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.notEqual(r.code, 0);
        const s = await f.story();
        assert.equal(s.evidence[0].result, 'fail');
        assert.match(s.evidence[0].error, /assertion output unavailable/i);
    } finally { await f.cleanup(); }
});

test('acknowledged large run journals do not accumulate until checkpoints block new checks', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('x'.repeat(63000))"]);
        for (let i = 0; i < 4; i++) { const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env); assert.equal(r.code, 0, r.err); }
        const s = await f.story();
        assert.equal(s.evidence.length, 4);
        assert.equal(s.checkpoints[0].journals.length, 0);
    } finally { await f.cleanup(); }
});

test('authoritative run registered before journal crash is recovered honestly from tracker records', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        await f.go('begin_run', { attempt_id: s.attempt_id, worker: 'w', lease_token: s.claim.token, kind: 'functional', commit: f.source, command: 'never executed', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false });
        await f.configure([process.execPath, '-e', 'process.exit(0)'], { confirm_interrupted: true });
        const r = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.equal((await f.story()).evidence[0].result, 'blocked');
    } finally { await f.cleanup(); }
});

test('durable snapshot is written during a total database outage and newer local snapshot wins on resume', async () => {
    const f = await scenario();
    try {
        f.env.COGUMI_CHECKPOINT_DIR = path.join(f.dir, 'durable');
        await f.configure([process.execPath, '-e', "setTimeout(()=>console.log('new durable result'),400)"]);
        const running = invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        for (let i = 0; i < 200; i++) {
            const s = await f.story();
            if (s.checkpoints?.[0]?.stage === 'before_test') { await f.setOfflineAll(true); break; }
            await new Promise(r => setTimeout(r, 10));
        }
        const r = await running;
        assert.equal(r.code, 2, r.err);
        await fs.rm(f.env.COGUMI_OUTBOX, { recursive: true });
        await fs.rm(f.env.COGUMI_RUNS, { recursive: true });
        await f.setOfflineAll(false);
        const restored = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(restored.code, 0, restored.err);
        const s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.evidence[0].result, 'pass');
        assert.equal(s.evidence[0].output, 'new durable result\n');
    } finally { await f.cleanup(); }
});

test('new attempt resumes without replaying completed journals from prior attempt', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('first')"]);
        assert.equal((await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env)).code, 0);
        await f.go('request_rework', { reason: 'fix', classification: 'unmet' });
        await f.go('update_status', { status: 'Backlog' });
        await f.go('update_status', { status: 'Ready', reason: 'approved' });
        const s = await f.go('claim_story', { worker: 'new', branch: 'fix', starting_commit: f.source, plan: 'correct' });
        await f.go('set_commit', { worker: 'new', lease_token: s.claim.token, attempt_id: s.attempt_id, commit: f.source });
        await f.configure([process.execPath, '-e', "console.log('first')"], { attempt_id: s.attempt_id });
        const r = await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.equal((await f.story()).evidence.length, 1);
    } finally { await f.cleanup(); }
});

test('timeout terminates ordinary descendant processes before returning', async () => {
    const f = await scenario();
    try {
        const marker = path.join(f.dir, 'late-effect');
        const code = "const cp=require('child_process');cp.spawn(process.execPath,['-e'," + JSON.stringify("setTimeout(()=>require('fs').writeFileSync(" + JSON.stringify(marker) + ",'survived'),700)") + "],{stdio:'ignore'});setInterval(()=>{},1000)";
        await f.configure([process.execPath, '-e', code], { timeout_ms: 200 });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.notEqual(r.code, 0);
        await new Promise(r => setTimeout(r, 900));
        await assert.rejects(fs.readFile(marker, 'utf8'), { code: 'ENOENT' });
        const s = await f.story();
        assert.equal(s.evidence[0].result, 'fail');
        assert.match(s.evidence[0].error, /timed out/);
    } finally { await f.cleanup(); }
});

test('attempt checkpoint and reporting preserve foreign scoped events without replaying them', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log('current attempt')"]);
        await fs.mkdir(f.env.COGUMI_OUTBOX, { recursive: true });
        const foreign = { sequence: 1, action: 'record_evidence', args: { project_id: 'other-project', story_id: 'other-story', event_id: 'foreign-event', evidence: { attempt_id: 'other-attempt', run_id: 'foreign-run' } } };
        await fs.writeFile(path.join(f.env.COGUMI_OUTBOX, '000000000001-foreign-event.json'), JSON.stringify(foreign));
        await fs.writeFile(path.join(f.env.COGUMI_OUTBOX, '.sequence'), '1');
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.env.COGUMI_OUTBOX, '000000000001-foreign-event.json'), 'utf8')), foreign);
        const s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.equal(s.checkpoints[0].pending_events, 0);
        assert.equal((await invoke('scripts/workflow.mjs', ['resume', f.cfg], f.repo, f.env)).code, 0);
    } finally { await f.cleanup(); }
});

// ---- Claude edition ---------------------------------------------------------

test('reporter wrapper leaves the checkout Git status and Git configuration unchanged (scenario 18)', async () => {
    const f = await scenario();
    try {
        delete f.env.COGUMI_OUTBOX; // default data-root locations, as in normal use
        delete f.env.COGUMI_RUNS;
        const before = { status: f.git(['status', '--porcelain', '--ignored']), exclude: await fs.readFile(path.join(f.repo, '.git', 'info', 'exclude'), 'utf8').catch(() => null), config: await fs.readFile(path.join(f.repo, '.git', 'config'), 'utf8') };
        await f.configure([process.execPath, '-e', "console.log('ok')"]);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.equal(f.git(['status', '--porcelain', '--ignored']), before.status);
        assert.equal(await fs.readFile(path.join(f.repo, '.git', 'info', 'exclude'), 'utf8').catch(() => null), before.exclude);
        assert.equal(await fs.readFile(path.join(f.repo, '.git', 'config'), 'utf8'), before.config);
        await fs.access(path.join(f.env.COGUMI_KANBAN_HOME, 'outbox'));
        await fs.access(path.join(f.env.COGUMI_KANBAN_HOME, 'runs'));
        assert.equal((await f.story()).eligibility.functional, true);
    } finally { await f.cleanup(); }
});

test('output with token-like keys and credential-looking text is checkpointed and recorded with redaction (scenario 19)', async () => {
    const f = await scenario();
    try {
        await f.configure([process.execPath, '-e', "console.log(JSON.stringify({max_tokens:512,token_count:3,usage:{prompt_tokens:1}}));console.log('Authorization: Bearer abcdefgh12345678')"]);
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        const s = await f.story();
        assert.equal(s.evidence.length, 1);
        assert.match(s.evidence[0].output, /"max_tokens":512/);
        assert.doesNotMatch(s.evidence[0].output, /abcdefgh12345678/);
        assert.match(s.evidence[0].output, /\[redacted\]/);
        assert.equal(s.checkpoints[0].stage, 'after_test');
        assert.equal(s.eligibility.functional, true);
    } finally { await f.cleanup(); }
});

test('a permanently rejected event is quarantined visibly and later events are still delivered (scenario 20)', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const env = f.env;
        const bad = { project_id: f.project.id, story_id: 'S', event_id: 'bad-evidence', evidence: { run_id: 'no-such-run', attempt_id: s.attempt_id, criterion_revision: 1, commit: f.source, end_commit: f.source, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: '' } };
        // Queue the bad event first, then a valid heartbeat behind it.
        const queue = (action, args) => new Promise(resolve => {
            const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'scripts/report.mjs'), action], { cwd: f.repo, env: { ...process.env, ...env } });
            let err = '';
            p.stderr.on('data', b => err += b);
            p.on('close', code => resolve({ code, err }));
            p.stdin.end(JSON.stringify(args));
        });
        await f.setOfflineAll(true); // hold delivery so both events queue in order
        await queue('record_evidence', bad);
        await queue('heartbeat_attempt', { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'good-heartbeat' });
        await f.setOfflineAll(false);
        const flushed = await invoke('scripts/report.mjs', ['flush'], f.repo, env);
        assert.equal(flushed.code, 3, flushed.err);
        assert.match(flushed.err, /Rejected bad-evidence/);
        assert.match(flushed.out, /Delivered good-heartbeat/);
        const rejected = await fs.readdir(path.join(env.COGUMI_OUTBOX, '.rejected'));
        assert.equal(rejected.filter(n => n.endsWith('-bad-evidence.json')).length, 1);
        await f.configure([process.execPath, '-e', '0']);
        const observed = JSON.parse((await invoke('scripts/workflow.mjs', ['observe', f.cfg], f.repo, env)).out);
        assert.equal(observed.pending_events, 0);
        assert.equal(observed.rejected_events.length, 1);
        assert.equal(observed.rejected_events[0].event_id, 'bad-evidence');
    } finally { await f.cleanup(); }
});

test('a heartbeat failure is recorded as a warning and the check runs to completion (scenario 21)', async () => {
    const f = await scenario();
    try {
        await fs.writeFile(path.join(f.dir, 'fault.json'), JSON.stringify(['heartbeat_attempt']));
        await f.configure([process.execPath, '-e', "setTimeout(()=>console.log('finished after heartbeats'),1000)"], { heartbeat_ms: 100 });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        assert.match(r.err, /heartbeat failed/);
        const s = await f.story();
        assert.equal(s.evidence[0].result, 'pass');
        assert.match(s.evidence[0].output, /finished after heartbeats/);
        assert.match(s.evidence[0].output, /\[cogumi\] heartbeat failed/);
    } finally { await f.cleanup(); }
});

test('reporter scoped to one attempt cannot act on another story or outside reporter actions (scenario 9)', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const { deliverAsReporter, closeReporterService } = await import('../src/server/reporter.ts');
        process.env.COGUMI_KANBAN_HOME = f.env.COGUMI_KANBAN_HOME;
        try {
            await assert.rejects(deliverAsReporter('update_status', { project_id: f.project.id, story_id: 'S', status: 'Shipped' }, { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id }), e => e.permanent && /not permitted/.test(e.message));
            await assert.rejects(deliverAsReporter('heartbeat_attempt', { project_id: f.project.id, story_id: 'S', attempt_id: 'invented', event_id: 'x1' }, { project_id: f.project.id, story_id: 'S', attempt_id: 'invented' }), e => e.permanent && /attempt does not exist/.test(e.message));
            await assert.rejects(deliverAsReporter('heartbeat_attempt', { project_id: f.project.id, story_id: 'OTHER', attempt_id: s.attempt_id, event_id: 'x2' }, { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id }), e => e.permanent);
            const ok = await deliverAsReporter('heartbeat_attempt', { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'x3' }, { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id });
            assert.ok(ok);
        } finally {
            closeReporterService();
            delete process.env.COGUMI_KANBAN_HOME;
        }
    } finally { await f.cleanup(); }
});
