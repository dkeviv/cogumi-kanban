// Repository binding (PRD PRJ 01, scenario 22).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeOrigin, observeBinding } from '../src/server/binding.ts';
import { makeRepo } from './local-fixture.mjs';

test('SSH, HTTPS, credentialed and .git forms of one origin normalize to one binding', () => {
    const expected = 'https://github.com/cogumi/app';
    for (const url of ['git@github.com:cogumi/app.git', 'git@github.com:cogumi/app', 'https://github.com/cogumi/app.git', 'https://github.com/cogumi/app/', 'https://user:secret@GitHub.com/cogumi/app.git', 'ssh://git@github.com/cogumi/app.git', 'git+ssh://git@github.com/cogumi/app'])
        assert.equal(normalizeOrigin(url), expected, url);
    assert.equal(normalizeOrigin('ssh://git@gitlab.example.com:2222/group/sub/app.git'), 'https://gitlab.example.com/group/sub/app');
    assert.doesNotMatch(normalizeOrigin('https://user:secret@host.test/a/b'), /secret/);
});

test('worktrees share the binding of their repository, with and without an origin', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-bind-'));
    try {
        const remote = await makeRepo(path.join(dir, 'with-origin'));
        remote.git(['worktree', 'add', '-q', path.join(dir, 'wt1'), '-b', 'feature']);
        assert.equal(observeBinding(remote.repo).binding, 'https://github.com/cogumi/integration');
        assert.equal(observeBinding(path.join(dir, 'wt1')).binding, 'https://github.com/cogumi/integration');

        const local = await makeRepo(path.join(dir, 'no-origin'), { origin: null });
        local.git(['worktree', 'add', '-q', path.join(dir, 'wt2'), '-b', 'feature']);
        const a = observeBinding(local.repo).binding, b = observeBinding(path.join(dir, 'wt2')).binding;
        assert.match(a, /^local:\//);
        assert.equal(a, b);
        assert.equal(observeBinding(path.join(local.repo)).origin, null);
        assert.throws(() => observeBinding(dir), /Not inside a Git repository/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
