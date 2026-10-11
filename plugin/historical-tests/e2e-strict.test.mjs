// The documented workflow followed literally on a strict project (the default), from
// project creation to Shipped, using bin/kanban exactly as the skill instructs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execSync } from 'node:child_process';
import { KanbanService } from '../src/server/service.ts';
import { makeRepo } from './local-fixture.mjs';

test('strict project goes from creation to Shipped by following the skill, surviving a rejected registration', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-e2e-'));
    const home = path.join(dir, 'home');
    const { repo, git } = await makeRepo(dir, { origin: 'git@github.com:example/final-demo.git' });
    await fs.writeFile(path.join(repo, 'check.cjs'), "require('fs').writeFileSync(process.env.COGUMI_ASSERTION_FILE, JSON.stringify(['returns 200','body ok'].map(name => ({ check_id: process.env.CHECK_ID, name, result: 'pass' }))));console.log('checked', process.env.COGUMI_TARGET_URL || 'local')");
    git(['add', '.']); git(['commit', '-qm', 'check']);
    const head = git(['rev-parse', 'HEAD']);
    const kanban = (checkId, ...args) => spawnSync('sh', [path.resolve('bin/kanban'), ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, COGUMI_KANBAN_HOME: home, CHECK_ID: checkId } });
    const k = new KanbanService(path.join(home, 'kanban.db'));
    try {
        const binding = JSON.parse(kanban('', 'workflow', 'binding').stdout).binding;
        assert.equal(binding, 'https://github.com/example/final-demo');
        const p = await k.call('create_project', {delivery_mode:'approval', name: 'Final Demo', binding, event_id: 'cp' });
        assert.equal(p.workflow.strict_checks, true);
        const go = (action, args) => k.call(action, { project_id: p.id, story_id: 'S1', event_id: crypto.randomUUID(), ...args });
        const checks = [{ id: 'S1-api', kind: 'functional', command: 'node check.cjs', assertions: ['returns 200', 'body ok'] }, { id: 'S1-deployed', kind: 'deployed', command: 'node check.cjs', assertions: ['returns 200', 'body ok'] }];
        const story = { id: 'S1', epic: 'E1', title: 'Save profile', criteria: ['saved'], proof_plan: [{ type: 'api', expected: 'works', evidence_requirement: 'named assertions', checks }] };
        await go('import_stories', { stories: [story], source: 'PRD', source_revision: 'r1' });
        await go('set_requirements', { source: 'PRD', source_revision: 'r1', requirements: [{ id: 'R1', epic: 'E1', phase: 'MVP', stories: ['S1'] }] });
        await go('approve_scope', { phases: ['MVP'], environments: ['local', 'production'], reason: 'owner approved in chat' });
        await go('update_status', { status: 'Backlog' });
        await go('update_status', { status: 'Ready', reason: 'reviewed' });
        await go('start_session', { binding, thread_id: 'claude-e2e', commit: head, pending_events: 0 });
        const c = await go('claim_story', { binding, worker: 'claude:e2e', branch: 'main', starting_commit: head, plan: 'run checks' });
        const lease = { worker: 'claude:e2e', attempt_id: c.attempt_id, lease_token: c.claim.token };
        await go('set_commit', { ...lease, commit: head });
        await go('update_status', { ...lease, status: 'Verifying' });
        await fs.mkdir(path.join(home, 'configs'), { recursive: true });
        const base = { project_id: p.id, story_id: 'S1', attempt_id: c.attempt_id, binding, criteria: [0], verification_types: ['api'], mocked: false, command: ['node', 'check.cjs'] };
        const cfg = path.join(home, 'configs', 'S1.json'), dcfg = path.join(home, 'configs', 'S1-deployed.json');
        await fs.writeFile(cfg, JSON.stringify({ ...base, environment: 'local', kind: 'functional', check_ids: ['S1-wrong'], assertion_file: path.join(home, 'configs', 'a.json') }));
        let r = kanban('S1-api', 'workflow', 'test', cfg);
        assert.equal(r.status, 4, r.stderr);
        await fs.writeFile(cfg, JSON.stringify({ ...base, environment: 'local', kind: 'functional', check_ids: ['S1-api'], assertion_file: path.join(home, 'configs', 'a.json') }));
        r = kanban('S1-api', 'workflow', 'test', cfg);
        assert.equal(r.status, 0, r.stderr);
        await go('update_status', { ...lease, status: 'Ready to ship' });
        const provider = path.join(home, 'configs', 'provider.json');
        await fs.writeFile(provider, JSON.stringify({ provider: 'demo-host', deployment_id: 'd1', version_id: 'v1', commit_sha: head, status: 'succeeded', url: 'https://final-demo.example.test', environment: 'production' }));
        await fs.writeFile(dcfg, JSON.stringify({ ...base, environment: 'production', kind: 'deployed', release_version: 'v1', target_url: 'https://final-demo.example.test', check_ids: ['S1-deployed'], assertion_file: path.join(home, 'configs', 'd.json') }));
        r = kanban('', 'workflow', 'release', dcfg, provider);
        assert.equal(r.status, 0, r.stderr);
        r = kanban('S1-deployed', 'workflow', 'test', dcfg);
        assert.equal(r.status, 0, r.stderr);
        r = kanban('', 'workflow', 'before-close', dcfg);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, /Resolved rejected begin_run/);
        await go('update_status', { ...lease, status: 'Shipped' });
        const ov = await k.call('board_overview', { project_id: p.id });
        assert.equal(ov.stories[0].status, 'Shipped');
        assert.equal(ov.stories[0].eligibility.deployed, true);
        assert.equal(ov.summary.epics[0].complete, true);
        assert.equal(kanban('', 'cli', 'snapshot').status, 0);
        assert.equal(execSync('git status --porcelain', { cwd: repo, encoding: 'utf8' }), '');
    } finally { k.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
