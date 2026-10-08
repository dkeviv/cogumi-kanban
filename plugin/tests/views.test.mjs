// Redacted read models used by the Artifact board (PRD SEC 01, UI 01, UI 02).
import test from 'node:test';
import assert from 'node:assert/strict';
import { KanbanService } from '../src/server/service.ts';
import { A } from './helpers.mjs';

async function claimed() {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', { strict_checks: false, name: 'Board', binding: 'https://example.test/b', event_id: 'c' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S1', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { stories: [
        { id: 'S1', title: 'First', epic: 'E1', phase: 'MVP', criteria: ['works'], proof_plan: [{ type: 'logic', expected: 'works' }] },
        { id: 'S2', title: 'Second', epic: 'E1', phase: 'MVP', criteria: ['also'], proof_plan: [{ type: 'logic', expected: 'also' }], dependencies: ['S1'] },
        { id: 'S3', title: 'Later', epic: 'E2', phase: 'Next', criteria: ['later'], proof_plan: [{ type: 'logic', expected: 'later' }] },
    ], source: 'PRD', source_revision: '1' });
    await go('set_requirements', { source: 'PRD', source_revision: '1', requirements: [{ id: 'R1', epic: 'E1', phase: 'MVP', stories: ['S1', 'S2'] }, { id: 'R2', epic: 'E2', phase: 'Next', stories: ['S3'] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    await go('update_status', { story_id: 'S2', status: 'Backlog' }); // S2 waits on its dependency
    const claim = await go('claim_story', { worker: 'claude:session-1', branch: 'main', starting_commit: A, plan: 'do it' });
    await go('set_commit', { worker: 'claude:session-1', attempt_id: claim.attempt_id, lease_token: claim.claim.token, commit: A });
    await go('update_status', { worker: 'claude:session-1', attempt_id: claim.attempt_id, lease_token: claim.claim.token, status: 'Verifying' });
    const run = await go('begin_run', { worker: 'claude:session-1', attempt_id: claim.attempt_id, lease_token: claim.claim.token, kind: 'functional', commit: A, command: 'node t', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false });
    await go('record_evidence', { evidence: { run_id: run.id, attempt_id: claim.attempt_id, criterion_revision: run.criterion_revision, commit: A, end_commit: A, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: 'y'.repeat(5000) } });
    return { service, p, claim };
}

test('board_overview is compact, credential-free and keeps full-phase denominators', async () => {
    const { service, p, claim } = await claimed();
    const ov = await service.call('board_overview', { project_id: p.id });
    const text = JSON.stringify(ov);
    assert.ok(!text.includes(claim.claim.token), 'lease token must never reach the board');
    assert.ok(!text.includes('y'.repeat(100)), 'evidence output is not part of the overview');
    assert.equal(ov.states.length, 9);
    assert.deepEqual(ov.phases, ['MVP', 'Next']);
    const s1 = ov.stories.find(s => s.id === 'S1');
    assert.equal(s1.status, 'Verifying');
    assert.equal(s1.claim.worker, 'claude:session-1');
    assert.equal(s1.claim.expired, false);
    assert.match(s1.actor, /^local:/);
    assert.ok(s1.updated_at);
    assert.equal(ov.stories.find(s => s.id === 'S2').eligible_next, false, 'dependency unfinished');
    const mvp = await service.call('board_overview', { project_id: p.id, phase: 'MVP' });
    assert.deepEqual(mvp.stories.map(s => s.id), ['S1', 'S2']);
    const e1 = mvp.summary.epics.find(e => e.epic === 'E1');
    assert.equal(e1.total, 2);
    assert.equal(e1.complete, false);
    service.close();
});

test('story_detail exposes proof for inspection with truncated output and no lease token', async () => {
    const { service, p, claim } = await claimed();
    const d = await service.call('story_detail', { project_id: p.id, story_id: 'S1' });
    assert.ok(!JSON.stringify(d).includes(claim.claim.token));
    assert.equal(d.runs.length, 1);
    assert.equal(d.evidence[0].result, 'pass');
    assert.ok(d.evidence[0].output.length < 2100);
    assert.match(d.evidence[0].output, /more characters/);
    assert.deepEqual(d.criteria, ['works']);
    assert.equal(d.proof_plan[0].type, 'logic');
    await assert.rejects(service.call('story_detail', { project_id: p.id, story_id: 'NOPE' }), /Story not found/);
    service.close();
});

test('rework from the board withdraws completion and is visible in both views (scenario 15)', async () => {
    const { service, p } = await claimed();
    await service.call('request_rework', { project_id: p.id, story_id: 'S1', event_id: 'rw1', reason: 'Button does nothing', observed: 'No save', expected: 'Saved', classification: 'unmet' });
    const ov = await service.call('board_overview', { project_id: p.id });
    const s1 = ov.stories.find(s => s.id === 'S1');
    assert.ok(s1.open_rework >= 1 || s1.status === 'Needs rework' || s1.status === 'Ready');
    const d = await service.call('story_detail', { project_id: p.id, story_id: 'S1' });
    assert.equal(d.rework.at(-1).reason, 'Button does nothing');
    assert.equal(d.eligibility.functional, false);
    service.close();
});
