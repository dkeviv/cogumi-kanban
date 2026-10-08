// Local SQLite storage adapter, identity and service (PRD SEC 01, DAT 01).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { KanbanService } from '../src/server/service.ts';
import { openStore, isTransient, assertNodeVersion } from '../src/server/store.ts';
import { ownerActor, reporterActor, BOARD_KEY } from '../src/server/identity.ts';
import { runWithDb } from '../src/engine/persistence.ts';
import { A } from './helpers.mjs';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'cgk-store-'));

async function readyStory(service, strict = false) {
    const p = await service.call('create_project', { strict_checks: strict, name: 'p', binding: 'https://example.test/p', event_id: 'create' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { stories: [{ id: 'S', title: 't', epic: 'E', criteria: ['works'], proof_plan: [{ type: 'logic', expected: 'works' }] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    return { p, go };
}

test('database file and directory are owner-only and WAL mode is enabled', async () => {
    const dir = await temp();
    const file = path.join(dir, 'nested', 'kanban.db');
    const old = process.umask(0o077);
    try {
        const store = openStore(file);
        assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        assert.equal((await store.prepare('PRAGMA journal_mode').first()).journal_mode, 'wal');
        assert.equal((await store.prepare("SELECT value FROM meta WHERE key='schema_version'").first()).value, '1');
        store.close();
    } finally { process.umask(old); await fs.rm(dir, { recursive: true, force: true }); }
});

test('a newer database schema is refused instead of being silently misread', async () => {
    const dir = await temp();
    const file = path.join(dir, 'kanban.db');
    try {
        const store = openStore(file);
        await store.prepare("UPDATE meta SET value='99' WHERE key='schema_version'").run();
        store.close();
        assert.throws(() => openStore(file), /newer than this plugin supports/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('two services on the same file racing to claim produce exactly one winner (scenario 2)', async () => {
    const dir = await temp();
    const file = path.join(dir, 'kanban.db');
    const a = new KanbanService(file), b = new KanbanService(file);
    try {
        const { p } = await readyStory(a);
        const claim = (svc, worker) => svc.call('claim_story', { project_id: p.id, binding: p.binding, story_id: 'S', event_id: crypto.randomUUID(), worker, branch: 'main', starting_commit: A, plan: 'x' });
        const results = await Promise.allSettled([claim(a, 'one'), claim(b, 'two')]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.match(results.find(r => r.status === 'rejected').reason.message, /Ready and unclaimed|Concurrent/);
    } finally { a.close(); b.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('two separate processes racing to claim produce exactly one winner (scenario 2)', async () => {
    const dir = await temp();
    const file = path.join(dir, 'kanban.db');
    const service = new KanbanService(file);
    try {
        const { p } = await readyStory(service);
        service.close();
        const script = `import {KanbanService} from ${JSON.stringify(path.resolve('src/server/service.ts'))};const s=new KanbanService(${JSON.stringify(file)});try{await s.call('claim_story',{project_id:${JSON.stringify(p.id)},binding:${JSON.stringify(p.binding)},story_id:'S',event_id:crypto.randomUUID(),worker:process.argv[1],branch:'main',starting_commit:'${A}',plan:'x'});console.log('won')}catch(e){console.log('lost:'+e.message)}`;
        const run = worker => new Promise(resolve => { const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script, worker]); let out = ''; c.stdout.on('data', d => out += d); c.on('close', () => resolve(out.trim())); });
        const outcomes = await Promise.all([run('p1'), run('p2'), run('p3')]);
        assert.equal(outcomes.filter(o => o === 'won').length, 1, outcomes.join(' | '));
        const board = await new KanbanService(file).call('get_board', { project_id: p.id });
        assert.equal(board.stories[0].attempts.length, 1);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('legacy completion migration is persisted on read with history retained', async () => {
    const store = openStore(':memory:');
    const legacy = { projects: [{ id: 'legacy', name: 'Legacy', binding: 'repo:legacy', scope: 'legacy', stories: [{ id: 'S', epic: 'E', title: 'Old', phase: 'MVP', priority: 1, status: 'Shipped', criteria: ['saved'], dependencies: [], version: 1, history: [{ action: 'legacy ship' }], evidence: [] }], events: [] }] };
    await store.prepare('INSERT INTO boards(owner,revision,data) VALUES(?,1,?)').bind(BOARD_KEY, JSON.stringify(legacy)).run();
    const board = await runWithDb(store, BOARD_KEY, 'get_board', { project_id: 'legacy' }, ownerActor());
    assert.equal(board.stories[0].status, 'Draft');
    const row = await store.prepare('SELECT data,revision FROM boards WHERE owner=?').bind(BOARD_KEY).first();
    assert.equal(row.revision, 2);
    const saved = JSON.parse(row.data).projects[0].stories[0];
    assert.equal(saved.status, 'Draft');
    assert.equal(saved.history[0].action, 'legacy ship');
    store.close();
});

test('owner actor names the local user; reporter actor requires a complete valid scope', () => {
    assert.match(ownerActor().id, /^local:/);
    assert.equal(ownerActor().role, 'owner');
    assert.throws(() => reporterActor({ project_id: 'p', story_id: 's' }), /attempt_id/);
    assert.throws(() => reporterActor({ project_id: 'p', story_id: 's b', attempt_id: 'a' }), /story_id/);
    assert.deepEqual(reporterActor({ project_id: 'p', story_id: 's', attempt_id: 'a' }), { id: 'reporter:a', role: 'reporter', project_id: 'p', story_id: 's', attempt_id: 'a' });
});

test('engine refuses owner actions for a reporter actor even on direct calls', async () => {
    const service = new KanbanService(':memory:');
    const { p } = await readyStory(service);
    const reporter = reporterActor({ project_id: p.id, story_id: 'S', attempt_id: 'a1' });
    for (const action of ['approve_scope', 'update_status', 'claim_story', 'revise_story', 'request_rework'])
        await assert.rejects(service.call(action, { project_id: p.id, story_id: 'S', event_id: crypto.randomUUID(), status: 'Shipped', phases: ['MVP'], environments: ['local'], reason: 'x' }, reporter), /permission/i);
    service.close();
});

test('transient storage failures are classified separately from validation errors', () => {
    assert.equal(isTransient(Object.assign(new Error('database is locked'), { errcode: 5 })), true);
    assert.equal(isTransient(Object.assign(new Error('unable to open database file'), { errcode: 14 })), true);
    assert.equal(isTransient(new Error('Concurrent update; retry same event_id after rereading')), true);
    assert.equal(isTransient(new Error('Owner permission required')), false);
    assert.equal(isTransient(Object.assign(new Error('constraint'), { errcode: 19 })), false);
});

test('service rejects unknown tools and enforces Node.js 22.13+', async () => {
    const service = new KanbanService(':memory:');
    await assert.rejects(service.call('mint_reporter', {}), /Unknown tool/);
    await assert.rejects(service.call('drop_everything', {}), /Unknown tool/);
    service.close();
    assert.throws(() => assertNodeVersion('22.12.0'), /22\.13/);
    assert.throws(() => assertNodeVersion('20.18.1'), /22\.13/);
    assertNodeVersion('22.13.0');
    assertNodeVersion('26.1.0');
});
