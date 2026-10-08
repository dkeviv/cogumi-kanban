// Import of a ChatGPT-edition board export (PRD MIG 01, scenario 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { KanbanService } from '../src/server/service.ts';
import { importBoard, exportBoard, parseExport } from '../src/server/migrate.ts';
import { invoke } from './local-fixture.mjs';
import { A } from './helpers.mjs';

// Builds a realistic export: real engine get_board output from a separate tracker,
// as the ChatGPT edition's get_board would return it (same engine, Site binding).
async function chatgptExport() {
    const source = new KanbanService(':memory:');
    const p = await source.call('create_project', { strict_checks: false, name: 'Abovely', binding: 'site:appgprj_123', event_id: 'c' });
    const go = (action, args = {}) => source.call(action, { project_id: p.id, binding: p.binding, story_id: 'S1', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { stories: [{ id: 'S1', title: 'One', epic: 'E', criteria: ['a'], proof_plan: [{ type: 'logic', expected: 'a' }] }, { id: 'S2', title: 'Two', epic: 'E', criteria: ['b'], proof_plan: [{ type: 'logic', expected: 'b' }] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    const claim = await go('claim_story', { worker: 'codex', branch: 'main', starting_commit: A, plan: 'x' });
    await go('set_commit', { worker: 'codex', attempt_id: claim.attempt_id, lease_token: claim.claim.token, commit: A });
    const run = await go('begin_run', { worker: 'codex', attempt_id: claim.attempt_id, lease_token: claim.claim.token, kind: 'functional', commit: A, command: 'node t', environment: 'local', criteria: [0], verification_types: ['logic'], mocked: false, dirty: false });
    await go('record_evidence', { evidence: { run_id: run.id, attempt_id: claim.attempt_id, criterion_revision: run.criterion_revision, commit: A, end_commit: A, dirty: false, mocked: false, result: 'pass', exit_code: 0, output: 'ok' } });
    const board = await go('get_board');
    source.close();
    return { exported: JSON.parse(JSON.stringify([board])), token: claim.claim.token, projectId: p.id };
}

test('import strips derived fields, expires claims, keeps IDs and history, and re-import is a no-op', async () => {
    const { exported, token, projectId } = await chatgptExport();
    const service = new KanbanService(':memory:');
    const first = await importBoard(service, exported);
    assert.deepEqual(first.imported, [projectId]);
    assert.equal(first.stories, 2);
    assert.equal(first.evidence, 1);
    assert.equal(first.expired_claims, 1);
    const { board } = await service.readBoard();
    const p = board.projects[0];
    assert.equal(p.metrics, undefined);
    assert.equal(p.summary, undefined);
    assert.ok(p.stories.every(s => s.eligibility === undefined));
    const s1 = p.stories.find(s => s.id === 'S1');
    assert.notEqual(s1.claim.token, token, 'old lease token must not survive');
    assert.ok(Date.parse(s1.claim.expires) < Date.now());
    assert.equal(p.imported_from.edition, 'chatgpt-sites');
    assert.ok(p.audit.some(a => a.actor === 'local:' + os.userInfo().username && a.action === 'import_chatgpt_board'));
    // engine accepts the imported board and keeps it consistent
    const live = await service.call('get_board', { project_id: projectId });
    assert.equal(live.stories.find(s => s.id === 'S1').evidence.length, 1);
    const second = await importBoard(service, exported);
    assert.deepEqual(second.imported, []);
    assert.deepEqual(second.unchanged, [projectId]);
    assert.equal(second.stories, 0);
    service.close();
});

test('the old lease token cannot drive work after import; the owner must reconcile and add a binding', async () => {
    const { exported, token, projectId } = await chatgptExport();
    const service = new KanbanService(':memory:');
    await importBoard(service, exported);
    const s = (await service.call('get_board', { project_id: projectId })).stories[0];
    await assert.rejects(service.call('set_commit', { project_id: projectId, story_id: 'S1', event_id: 'e1', worker: 'codex', attempt_id: s.attempt_id, lease_token: token, commit: A }));
    await service.call('add_binding', { project_id: projectId, event_id: 'b1', binding: 'https://github.com/cogumi/abovely', reason: 'owner confirmed' });
    assert.equal((await service.call('resolve_project', { binding: 'https://github.com/cogumi/abovely' })).id, projectId);
    service.close();
});

test('binding collisions are refused without partial writes; --replace overwrites an imported project', async () => {
    const { exported, projectId } = await chatgptExport();
    const service = new KanbanService(':memory:');
    await service.call('create_project', { name: 'Clash', binding: 'site:appgprj_123', event_id: 'x' });
    await assert.rejects(importBoard(service, exported), /already belongs/);
    assert.equal((await service.call('list_projects')).length, 1);
    service.close();
    const fresh = new KanbanService(':memory:');
    await importBoard(fresh, exported);
    const changed = structuredClone(exported);
    changed[0].name = 'Renamed';
    assert.deepEqual((await importBoard(fresh, changed, { replace: true })).replaced, [projectId]);
    assert.equal((await fresh.call('list_projects'))[0].name, 'Renamed');
    fresh.close();
});

test('malformed exports are rejected with actionable messages', () => {
    assert.throws(() => parseExport([]), /get_board result/);
    assert.throws(() => parseExport([{ id: 'p', name: 'x', binding: 'b' }]), /no stories array/);
    assert.throws(() => parseExport([{ id: 'p', stories: [] }]), /no binding/);
    assert.throws(() => parseExport([{ id: 'p', stories: [], binding: 'b' }, { id: 'p', stories: [], binding: 'c' }]), /same project twice/);
    assert.equal(parseExport({ projects: [{ id: 'p', stories: [], binding: 'b' }] }).length, 1);
});

test('CLI import and export round-trip through the data root', async () => {
    const { exported, projectId } = await chatgptExport();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-mig-'));
    try {
        const file = path.join(dir, 'export.json');
        await fs.writeFile(file, JSON.stringify(exported));
        const env = { COGUMI_KANBAN_HOME: path.join(dir, 'home') };
        const imported = await invoke('dist/cli.mjs', ['import', file], dir, env);
        assert.equal(imported.code, 0, imported.err);
        assert.deepEqual(JSON.parse(imported.out).imported, [projectId]);
        const again = await invoke('dist/cli.mjs', ['import', file], dir, env);
        assert.deepEqual(JSON.parse(again.out).unchanged, [projectId]);
        const out = path.join(dir, 'backup.json');
        assert.equal((await invoke('dist/cli.mjs', ['export', '--out', out], dir, env)).code, 0);
        const backup = JSON.parse(await fs.readFile(out, 'utf8'));
        assert.equal(backup[0].id, projectId);
        const service = new KanbanService(path.join(dir, 'home', 'kanban.db'));
        assert.equal((await exportBoard(service)).length, 1);
        service.close();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
