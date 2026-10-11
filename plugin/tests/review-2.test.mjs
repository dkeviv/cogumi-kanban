// Regression tests for the second code review (diff review and end-to-end review).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenario, invoke } from './local-fixture.mjs';
import { KanbanService } from '../src/server/service.ts';
import { exportBoard } from '../src/server/migrate.ts';
import { sniffId } from '../src/server/mcp.ts';
import { redactCredentials } from '../src/engine/checkpoints.ts';
import { A } from './helpers.mjs';

test('redaction never rewrites identifiers or ordinary words', async () => {
    const service = new KanbanService(':memory:');
    const binding = 'local:/Users/me/code/desk-management-application/.git';
    const p = await service.call('create_project', {delivery_mode:'approval', name: 'Desk', binding, event_id: 'task-create-1' });
    assert.equal((await service.call('resolve_project', { binding })).id, p.id);
    await service.call('import_stories', { project_id: p.id, event_id: 'risk-import', source: 'PRD', source_revision: '1', stories: [{ id: 'task-implement-signup-flow', epic: 'Basic authentication', title: 'Basic dashboard layout', criteria: ['Basic authentication works'] }] });
    const s = (await service.call('get_board', { project_id: p.id })).stories[0];
    assert.equal(s.id, 'task-implement-signup-flow');
    assert.equal(s.title, 'Basic dashboard layout');
    assert.deepEqual(s.criteria, ['Basic authentication works']);
    const ov = await service.call('board_overview', { project_id: p.id });
    assert.equal(ov.project.id, p.id);
    assert.equal(ov.project.binding, binding);
    for (const word of ['task-implement-the-signup-flow-now', 'Basic authentication', 'desk-management-application'])
        assert.equal(redactCredentials(word), word);
    service.close();
});

test('a rejected run registration is settled, so a later passing run can close the story', async () => {
    const f = await scenario();
    try {
        // Wrong criteria index: the engine refuses the run registration (never executed).
        await f.configure([process.execPath, '-e', "console.log('x')"], { criteria: [5] });
        const bad = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(bad.code, 4, bad.err);
        await f.configure([process.execPath, '-e', "console.log('good')"]);
        assert.equal((await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env)).code, 0);
        const closing = await invoke('scripts/workflow.mjs', ['before-close', f.cfg], f.repo, f.env);
        assert.equal(closing.code, 0, closing.err);
        assert.match(closing.err, /Resolved rejected begin_run/);
        assert.equal((await f.story()).eligibility.functional, true);
    } finally { await f.cleanup(); }
});

test('an unresolved rejection blocks before-close until the owner discards it with a reason', async () => {
    const f = await scenario();
    try {
        const s = await f.story();
        const outbox = f.env.COGUMI_OUTBOX;
        await fs.mkdir(path.join(outbox, '.rejected'), { recursive: true });
        const release = { sequence: 3, action: 'record_release', args: { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id, event_id: 'rel-1', release: { commit: f.source, version: 'v1', url: 'https://x.test', environment: 'local', result: 'succeeded' } } };
        await fs.writeFile(path.join(outbox, '.rejected', '000000000003-rel-1.json'), JSON.stringify({ event: release, error: 'Release refused', rejected_at: new Date().toISOString() }));
        await f.configure([process.execPath, '-e', '0']);
        let r = await invoke('scripts/workflow.mjs', ['before-close', f.cfg], f.repo, f.env);
        assert.equal(r.code, 3);
        assert.match(r.err, /Unresolved rejected record_release rel-1/);
        r = await invoke('scripts/report.mjs', ['discard', 'rel-1'], f.repo, f.env);
        assert.equal(r.code, 2, 'a reason is required');
        r = await invoke('scripts/report.mjs', ['discard', 'rel-1', '--reason', 'Owner: provider retried the deploy separately'], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
        const kept = JSON.parse(await fs.readFile(path.join(outbox, '.rejected', 'discarded', '000000000003-rel-1.json'), 'utf8'));
        assert.match(kept.discarded.reason, /provider retried/);
        r = await invoke('scripts/workflow.mjs', ['before-close', f.cfg], f.repo, f.env);
        assert.equal(r.code, 0, r.err);
    } finally { await f.cleanup(); }
});

test('resolving a rejected run twice is recognised as the same record (deterministic payload)', async () => {
    const f = await scenario();
    const old = { ...process.env };
    try {
        Object.assign(process.env, f.env);
        const { resolveRejected } = await import('../scripts/checkpoint.mjs');
        const { flush } = await import('../scripts/reporting.mjs');
        const s = await f.story();
        const run = await f.go('begin_run', { worker: 'w', attempt_id: s.attempt_id, lease_token: s.claim.token, kind: 'functional', commit: f.source, command: 'x', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false });
        const cfg = { project_id: f.project.id, story_id: 'S', attempt_id: s.attempt_id };
        assert.equal(await resolveRejected(cfg, run), true);
        await new Promise(r => setTimeout(r, 5));
        assert.equal(await resolveRejected(cfg, run), true);
        await flush(cfg);
        assert.equal(await resolveRejected(cfg, run), true, 'already delivered: same payload');
        const story = await f.story();
        assert.equal(story.evidence.filter(e => e.run_id === run.id).length, 1);
        assert.equal(story.evidence[0].result, 'blocked');
    } finally { process.env = old; await f.cleanup(); }
});

test('tool errors name missing fields instead of returning a validation blob', async () => {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', {delivery_mode:'approval', name: 'E', binding: 'https://e.test/e', event_id: 'c' });
    await service.call('import_stories', { project_id: p.id, event_id: 'i', source: 'P', source_revision: '1', stories: [{ id: 'S', epic: 'E', title: 't', criteria: ['x'], proof_plan: [{ type: 'logic', expected: 'x' }] }] });
    await service.call('approve_scope', { project_id: p.id, event_id: 'a', phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await service.call('update_status', { project_id: p.id, story_id: 'S', event_id: 'b', status: 'Backlog' });
    await assert.rejects(service.call('update_status', { project_id: p.id, story_id: 'S', event_id: 'r', status: 'Ready' }), e => /^Invalid arguments: .*Required/.test(e.message) && !e.message.includes('"code"'));
    service.close();
});

test('exports carry no lease tokens', async () => {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', {delivery_mode:'approval', strict_checks: false, name: 'X', binding: 'https://e.test/x', event_id: 'c' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { source: 'P', source_revision: '1', stories: [{ id: 'S', epic: 'E', title: 't', criteria: ['x'], proof_plan: [{ type: 'logic', expected: 'x' }] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    const c = await go('claim_story', { worker: 'w', branch: 'b', starting_commit: A, plan: 'p' });
    await go('set_commit', { worker: 'w', attempt_id: c.attempt_id, lease_token: c.claim.token, commit: A });
    const text = JSON.stringify(await exportBoard(service));
    assert.ok(!text.includes(c.claim.token));
    assert.match(text, /\[removed\]/);
    service.close();
});

test('assertion files outside scratch locations are refused before anything runs', async () => {
    const f = await scenario();
    try {
        const precious = path.join(f.repo, 'source.txt');
        await f.configure([process.execPath, '-e', '0'], { assertion_file: precious });
        const r = await invoke('scripts/test-and-report.mjs', [f.cfg], f.repo, f.env);
        assert.equal(r.code, 4);
        assert.match(r.err, /assertion_file must be under/);
        assert.equal(await fs.readFile(precious, 'utf8'), 'A');
        assert.equal((await f.story()).runs.length, 0);
    } finally { await f.cleanup(); }
});

test('oversized messages are answered with the top-level id only', () => {
    assert.equal(sniffId('{"jsonrpc":"2.0","method":"tools/call","params":{"arguments":{"stories":[{"id":"S1"'), null);
    assert.equal(sniffId('{"jsonrpc":"2.0","id":42,"method":"x"'), 42);
    assert.equal(sniffId('{"method":"m","params":{"a":1},"id":"r-1"'), 'r-1');
    assert.equal(sniffId('{"method":"m","params":{"note":"\\"id\\":7"},"id":8'), 8);
});

test('a delivery failure for an event without an attempt is visible in every scope', async () => {
    const f = await scenario();
    const old = { ...process.env };
    try {
        Object.assign(process.env, f.env);
        await fs.mkdir(f.env.COGUMI_OUTBOX, { recursive: true });
        await fs.writeFile(path.join(f.env.COGUMI_OUTBOX, '.last-failure'), JSON.stringify({ event_id: 'e1', scope: { project_id: f.project.id, story_id: 'S' }, error: 'database is locked' }));
        const { lastFailure } = await import('../scripts/reporting.mjs');
        assert.equal((await lastFailure({ project_id: f.project.id, story_id: 'S', attempt_id: 'any' }))?.event_id, 'e1');
        assert.equal(await lastFailure({ project_id: 'other', story_id: 'S', attempt_id: 'any' }), null);
    } finally { process.env = old; await f.cleanup(); }
});

test('board keeps an unsent rework draft and refills the project picker after a reconnect', async () => {
    const src = await fs.readFile('board/kanban-board.html', 'utf8');
    assert.match(src, /if \(!reworkDraft\(\)\) closeSheet\(\)/);
    assert.match(src, /if \(!\$\("project-select"\)\.options\.length && state\.projects\.length\) renderProjects\(\)/);
});
