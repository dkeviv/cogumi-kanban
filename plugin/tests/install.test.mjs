// Scenario 16: install the plugin from its marketplace into a clean, isolated Claude
// Code configuration and start the installed copy's MCP server and hook. Skipped when
// the `claude` CLI is not available. Never touches the user's own configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
const marketplace = path.resolve('..');

test('plugin installs from its marketplace into a clean configuration and its server starts (scenario 16)', { skip: !hasClaude && 'claude CLI not installed' }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-install-'));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'config'), COGUMI_KANBAN_HOME: path.join(dir, 'data') };
    const claude = (...args) => spawnSync('claude', args, { env, encoding: 'utf8', timeout: 120000 });
    try {
        for (const target of [marketplace, path.join(marketplace, 'plugin')]) {
            const v = claude('plugin', 'validate', target);
            assert.equal(v.status, 0, v.stdout + v.stderr);
        }
        let r = claude('plugin', 'marketplace', 'add', marketplace);
        assert.equal(r.status, 0, r.stdout + r.stderr);
        r = claude('plugin', 'install', 'cogumi-claude-kanban@cogumi');
        assert.equal(r.status, 0, r.stdout + r.stderr);
        r = claude('plugin', 'details', 'cogumi-claude-kanban@cogumi');
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /cogumi-workflow/);
        assert.match(r.stdout, /SessionStart/);
        assert.match(r.stdout, /kanban/);
        // Start the installed copy (not the source tree) the way Claude Code does.
        const find = async d => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name === 'cogumi-claude-kanban') return f; const x = await find(f); if (x) return x; } } return null; };
        const pkg = await find(path.join(dir, 'config'));
        assert.ok(pkg, 'installed plugin directory');
        const versions = await fs.readdir(pkg);
        const root = versions.length === 1 && !(await fs.stat(path.join(pkg, versions[0], '.claude-plugin')).catch(() => null)) ? pkg : path.join(pkg, versions[0]);
        const input = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }].map(m => JSON.stringify(m)).join('\n') + '\n';
        const server = spawnSync('sh', [path.join(root, 'bin/run-node.sh'), path.join(root, 'dist/server.mjs')], { env: { ...env, CLAUDE_PLUGIN_ROOT: root }, input, encoding: 'utf8', timeout: 30000 });
        const replies = server.stdout.trim().split('\n').map(l => JSON.parse(l));
        assert.equal(replies[0].result.serverInfo.name, 'cogumi-claude-kanban');
        assert.ok(replies[1].result.tools.some(t => t.name === 'board_overview'));
        const hook = spawnSync('sh', [path.join(root, 'bin/run-node.sh'), path.join(root, 'dist/hook.mjs')], { env: { ...env, CLAUDE_PLUGIN_ROOT: root }, input: JSON.stringify({ session_id: 's', cwd: dir }), encoding: 'utf8', timeout: 30000 });
        assert.equal(hook.status, 0, hook.stderr);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
