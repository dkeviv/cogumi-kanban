// MCP server protocol handling and the built stdio server (PRD WRK 02, PLG 01).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHandler, SUPPORTED_PROTOCOLS } from '../src/server/mcp.ts';
import { KanbanService, readOnlyTools } from '../src/server/service.ts';

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

test('initialize negotiates the protocol and carries Claude workflow instructions with resolved script paths', async () => {
    const handle = createHandler(new KanbanService(':memory:'), '/opt/plugin');
    const r = await handle(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
    assert.equal(r.result.protocolVersion, '2025-06-18');
    assert.equal(r.result.serverInfo.name, 'cogumi-claude-kanban');
    assert.match(r.result.instructions, /Claude Code/);
    assert.match(r.result.instructions, /sh \/opt\/plugin\/bin\/kanban workflow/);
    assert.doesNotMatch(r.result.instructions, /Codex|ChatGPT|Sites|<plugin>/);
    const old = await handle(rpc(2, 'initialize', { protocolVersion: '1999-01-01' }));
    assert.equal(old.result.protocolVersion, SUPPORTED_PROTOCOLS[0]);
});

test('tools/list exposes engine tools plus redacted views, without reporter credential minting, with read-only annotations', async () => {
    const handle = createHandler(new KanbanService(':memory:'), '/p');
    const { result } = await handle(rpc(1, 'tools/list'));
    const names = result.tools.map(t => t.name);
    for (const n of ['claim_story', 'begin_run', 'record_evidence', 'record_release', 'request_rework', 'reconcile', 'board_overview', 'story_detail']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('mint_reporter'));
    for (const t of result.tools) {
        assert.equal(t.inputSchema.type, 'object');
        assert.equal(t.annotations.readOnlyHint, readOnlyTools.includes(t.name), t.name);
    }
    assert.equal(result.tools.find(t => t.name === 'board_overview').annotations.readOnlyHint, true);
    assert.equal(result.tools.find(t => t.name === 'request_rework').annotations.readOnlyHint, false);
});

test('tool failures are tool results with isError; protocol errors use JSON-RPC codes; notifications get no reply', async () => {
    const handle = createHandler(new KanbanService(':memory:'), '/p');
    const missing = await handle(rpc(1, 'tools/call', { name: 'get_board', arguments: { project_id: 'nope' } }));
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /Project not found/);
    assert.equal((await handle(rpc(2, 'tools/call', { name: 'nope', arguments: {} }))).result.isError, true);
    assert.equal((await handle(rpc(3, 'tools/call', { name: 'list_projects', arguments: [] }))).result.isError, true);
    assert.equal((await handle(rpc(4, 'does/not/exist'))).error.code, -32601);
    assert.equal((await handle('{not json')).error.code, -32700);
    assert.equal((await handle(JSON.stringify({ jsonrpc: '1.0', id: 5, method: 'ping' }))).error.code, -32600);
    assert.equal(await handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null);
    assert.deepEqual((await handle(rpc(6, 'ping'))).result, {});
});

test('tools/call returns structured content and saved mutations', async () => {
    const handle = createHandler(new KanbanService(':memory:'), '/p');
    const created = await handle(rpc(1, 'tools/call', { name: 'create_project', arguments: { name: 'Demo', binding: 'https://example.test/demo', event_id: 'c1' } }));
    const project = created.result.structuredContent.result;
    assert.equal(project.name, 'Demo');
    assert.deepEqual(JSON.parse(created.result.content[0].text).id, project.id);
    const listed = await handle(rpc(2, 'tools/call', { name: 'list_projects', arguments: {} }));
    assert.equal(listed.result.structuredContent.result.length, 1);
});

test('the bundled stdio server answers in order through the Node launcher', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cgk-mcp-'));
    try {
        const child = spawn('sh', ['bin/run-node.sh', 'dist/server.mjs'], { env: { ...process.env, COGUMI_KANBAN_HOME: home, CLAUDE_PLUGIN_ROOT: process.cwd() } });
        let out = '', err = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => err += d);
        child.stdin.write(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }) + '\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        child.stdin.write(rpc(2, 'tools/call', { name: 'create_project', arguments: { name: 'Demo', binding: 'https://example.test/x', event_id: 'c' } }) + '\n');
        child.stdin.end(rpc(3, 'tools/call', { name: 'list_projects', arguments: {} }) + '\n');
        await new Promise(r => child.on('close', r));
        const replies = out.trim().split('\n').map(l => JSON.parse(l));
        assert.deepEqual(replies.map(r => r.id), [1, 2, 3], err);
        assert.equal(replies[2].result.structuredContent.result[0].name, 'Demo');
        assert.equal(err.includes('ExperimentalWarning'), false);
        assert.equal((await fs.stat(path.join(home, 'kanban.db'))).mode & 0o777, 0o600);
    } finally { await fs.rm(home, { recursive: true, force: true }); }
});
