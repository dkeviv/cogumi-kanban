import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/server/local-board.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { serveLocalBoard } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
test('local board uses fresh redacted service reads and rejects remote/writing requests', async () => {
 let value = 1;
 const service = { close() {}, async call(action) { return { action, value }; } };
 const board = await serveLocalBoard(fs.readFileSync('board/kanban-board.html', 'utf8'), { service });
 try {
  assert.equal(board.server.address().address, '127.0.0.1');
  assert.match(await (await fetch(board.url)).text(), /window.COGUMI_LOCAL_BOARD = true/);
  const api = board.url + 'api/board_overview?project_id=p';
  assert.equal((await (await fetch(api)).json()).payload.result.value, 1);
  value = 2;
  assert.equal((await (await fetch(api)).json()).payload.result.value, 2);
  assert.equal((await fetch(api, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal(await new Promise(resolve => { http.get(api, { headers: { Host: 'example.com' } }, r => { r.resume(); resolve(r.statusCode); }); }), 403);
  assert.equal((await fetch(api, { method: 'POST' })).status, 405);
  assert.equal((await fetch(board.url + 'api/get_board')).status, 404);
  assert.equal((await fetch(new URL('/api/list_projects', board.url))).status, 404);
 } finally { await new Promise(resolve => board.server.close(resolve)); }
});
