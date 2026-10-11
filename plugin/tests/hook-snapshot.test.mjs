// SessionStart hook (PRD WRK 02, PRJ 01) and static board snapshot (PRD UI 01).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { KanbanService } from '../src/server/service.ts';
import { renderSnapshot, embedJson, SNAPSHOT_MARKER } from '../src/server/snapshot.ts';
import { makeRepo, invoke, BINDING } from './local-fixture.mjs';

function runHook(input, env) {
    return new Promise(resolve => {
        const p = spawn('sh', ['bin/run-node.sh', 'dist/hook.mjs'], { env: { ...process.env, ...env } });
        let out = '', err = '';
        p.stdout.on('data', d => out += d);
        p.stderr.on('data', d => err += d);
        p.on('close', code => resolve({ code, out, err }));
        p.stdin.end(JSON.stringify(input));
    });
}

test('hook is silent outside bound repositories and gives context inside one', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-hook-'));
    try {
        const { repo } = await makeRepo(dir);
        const env = { COGUMI_KANBAN_HOME: path.join(dir, 'home'), CLAUDE_PLUGIN_ROOT: process.cwd() };
        let r = await runHook({ session_id: 'sess-1', cwd: repo }, env);
        assert.equal(r.code, 0);
        assert.equal(r.out, '', 'no database yet: silent');
        const service = new KanbanService(path.join(dir, 'home', 'kanban.db'));
        r = await runHook({ session_id: 'sess-1', cwd: dir }, env);
        assert.equal(r.out, '', 'not a repository: silent');
        const p = await service.call('create_project', {delivery_mode:'approval', name: 'Bound', binding: BINDING, event_id: 'c' });
        service.close();
        r = await runHook({ session_id: 'sess-1', cwd: repo }, env);
        assert.equal(r.code, 0, r.err);
        const out = JSON.parse(r.out).hookSpecificOutput;
        assert.equal(out.hookEventName, 'SessionStart');
        assert.match(out.additionalContext, new RegExp(p.id));
        assert.match(out.additionalContext, /sess-1/);
        assert.match(out.additionalContext, /bin\/kanban" workflow/);
        assert.match(out.additionalContext, /0 pending, 0 rejected/);
        r = await runHook('not json at all', env);
        assert.equal(r.code, 0, 'malformed input never blocks a session');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('snapshot embeds credential-free data safely and is labeled as a snapshot', async () => {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', {delivery_mode:'approval', name: 'Snap </script><script>alert(1)</script>', binding: 'https://example.test/s', event_id: 'c' });
    await service.call('import_stories', { project_id: p.id, event_id: 'i', stories: [{ id: 'S1', title: 'A $& story', epic: 'E', phase: 'MVP', criteria: ['x'] }, { id: 'S2', title: 'B', epic: 'E', phase: 'Next', criteria: ['y'] }] });
    const template = await fs.readFile('board/kanban-board.html', 'utf8');
    const html = await renderSnapshot(service, template, p.id);
    assert.ok(!html.includes(SNAPSHOT_MARKER));
    assert.equal(html.split('</script>').length, template.split('</script>').length + 1, 'embedded JSON cannot close its script element');
    const json = JSON.parse(html.match(/<script id="cogumi-snapshot" type="application\/json">([^<]*)<\/script>/)[1]);
    assert.equal(json.mode, 'snapshot');
    assert.deepEqual(Object.keys(json.overviews).sort(), ['', 'MVP', 'Next']);
    assert.deepEqual(json.overviews.MVP.stories.map(s => s.id), ['S1']);
    assert.equal(json.details.S1.title, 'A $& story');
    assert.equal(embedJson('</script>'), '"\\u003c/script\\u003e"');
    service.close();
});

test('snapshot CLI writes an owner-only file under the data root for the bound project', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-snap-'));
    try {
        const { repo } = await makeRepo(dir);
        const env = { COGUMI_KANBAN_HOME: path.join(dir, 'home') };
        const service = new KanbanService(path.join(dir, 'home', 'kanban.db'));
        const p = await service.call('create_project', {delivery_mode:'approval', name: 'Bound', binding: BINDING, event_id: 'c' });
        await service.call('create_project', {delivery_mode:'approval', name: 'Other', binding: 'https://example.test/other', event_id: 'd' });
        service.close();
        const r = await invoke('dist/cli.mjs', ['snapshot'], repo, env);
        assert.equal(r.code, 0, r.err);
        const file = path.join(dir, 'home', 'snapshots', `board-${p.id}.html`);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        assert.match(await fs.readFile(file, 'utf8'), /cogumi-snapshot/);
        const outside = await invoke('dist/cli.mjs', ['snapshot'], dir, env);
        assert.equal(outside.code, 2);
        assert.match(outside.err, /--project/);
        const doctor = JSON.parse((await invoke('dist/cli.mjs', ['doctor'], repo, env)).out);
        assert.equal(doctor.bound_project, p.id);
        assert.equal(doctor.projects, 2);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
