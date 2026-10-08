// Plugin packaging (PRD PLG 01, PLG 02, WRK 02, scenario 16 static checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = async file => fs.readFile(file, 'utf8');
const json = async file => JSON.parse(await read(file));

test('plugin and marketplace manifests are valid and agree', async () => {
    const plugin = await json('.claude-plugin/plugin.json');
    const market = await json('../.claude-plugin/marketplace.json');
    const pkg = await json('package.json');
    assert.equal(plugin.name, 'cogumi-claude-kanban');
    assert.equal(market.name, 'cogumi');
    const entry = market.plugins.find(p => p.name === plugin.name);
    assert.equal(entry.source, './plugin');
    assert.equal(entry.version, plugin.version);
    assert.equal(pkg.version, plugin.version);
});

test('MCP server and hook commands point at files that exist', async () => {
    const mcp = await json('.mcp.json');
    const server = mcp.mcpServers.kanban;
    assert.equal(server.command, 'sh');
    for (const arg of server.args) await fs.access(arg.replace('${CLAUDE_PLUGIN_ROOT}', '.'));
    const hooks = await json('hooks/hooks.json');
    const command = hooks.hooks.SessionStart[0].hooks[0].command;
    for (const file of command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[^"]+/g)) await fs.access(file.replace('${CLAUDE_PLUGIN_ROOT}', '.'));
});

test('skill and commands have frontmatter and reference only existing plugin files', async () => {
    const skill = await read('skills/cogumi-workflow/SKILL.md');
    assert.match(skill, /^---\nname: cogumi-workflow\ndescription: .+\n---\n/);
    const commands = await fs.readdir('commands');
    for (const name of ['start.md', 'next.md', 'board.md', 'snapshot.md', 'import-chatgpt.md', 'status.md']) assert.ok(commands.includes(name), name);
    for (const name of commands) {
        const text = await read(path.join('commands', name));
        assert.match(text, /^---\ndescription: .+\n---\n/, name);
        for (const ref of text.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[\w./-]+/g) || []) await fs.access(ref.replace('${CLAUDE_PLUGIN_ROOT}', '.'));
    }
    // Only the import command may talk about the ChatGPT edition.
    for (const text of [skill, ...await Promise.all(commands.filter(n => n !== 'import-chatgpt.md').map(n => read(path.join('commands', n))))]) assert.doesNotMatch(text, /Codex|ChatGPT|Sites|\.openai/);
});

test('board command manifest names exactly the tools the board page calls', async () => {
    const board = await read('board/kanban-board.html');
    const command = await read('commands/board.md');
    const called = new Set([...board.matchAll(/(?:callTool|watchTool|readTool)\((?:SERVER, )?"([a-z_]+)"/g)].map(m => m[1]));
    const declared = JSON.parse(command.match(/"tools": (\[[^\]]+\])/)[1]);
    assert.deepEqual([...called].sort(), [...declared].sort());
    assert.match(board, /const SERVER = "__COGUMI_MCP_SERVER__"/);
    assert.match(board, /<!--COGUMI_SNAPSHOT-->/);
    assert.match(board, /^<title>Cogumi Claude Kanban<\/title>/);
});

test('bundled dist is current with the sources', () => {
    const before = spawnSync('shasum', ['dist/server.mjs', 'dist/cli.mjs', 'dist/hook.mjs', 'dist/lib.mjs'], { encoding: 'utf8' }).stdout;
    assert.equal(spawnSync(process.execPath, ['build.mjs'], { encoding: 'utf8' }).status, 0);
    const after = spawnSync('shasum', ['dist/server.mjs', 'dist/cli.mjs', 'dist/hook.mjs', 'dist/lib.mjs'], { encoding: 'utf8' }).stdout;
    assert.equal(after, before, 'run `npm run build` and commit dist/');
});

test('launcher refuses an unsuitable Node.js with an actionable message', () => {
    const r = spawnSync('/bin/sh', ['bin/run-node.sh', '-e', 'process.exit(0)'], { encoding: 'utf8', env: { PATH: '/nonexistent', HOME: '/nonexistent', COGUMI_NODE: '/bin/false' } });
    if (r.status === 0) return; // a system node at a fixed path satisfied the check; nothing to assert
    assert.equal(r.status, 127);
    assert.match(r.stderr, /Node\.js 22\.13 or newer/);
});
