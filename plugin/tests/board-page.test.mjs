// The board page itself, run in jsdom with a stubbed Artifact `mcp` capability
// (PRD UI 01, UI 02, PLG 02, REW 01, scenario 10 and the board half of scenario 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { KanbanService } from '../src/server/service.ts';
import { renderSnapshot } from '../src/server/snapshot.ts';
import { A } from './helpers.mjs';

const SERVER = 'host:plugin_cogumi-kanban_kanban';
const template = await fs.readFile('board/kanban-board.html', 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function tracker() {
    const service = new KanbanService(':memory:');
    const p = await service.call('create_project', {delivery_mode:'approval', strict_checks: false, name: 'Live Board', binding: 'https://e.test/live', event_id: 'c' });
    const go = (action, args = {}) => service.call(action, { project_id: p.id, binding: p.binding, story_id: 'S1', event_id: crypto.randomUUID(), ...args });
    await go('import_stories', { source: 'PRD', source_revision: '1', stories: [{ id: 'S1', title: 'Save profile', epic: 'Onboarding', criteria: ['saved'], proof_plan: [{ type: 'api', expected: 'saved' }] }, { id: 'S2', title: 'Later', epic: 'Onboarding', phase: 'Next', criteria: ['later'] }] });
    await go('approve_scope', { phases: ['MVP'], environments: ['local'], reason: 'ok' });
    await go('update_status', { status: 'Backlog' });
    await go('update_status', { status: 'Ready', reason: 'ok' });
    const c = await go('claim_story', { worker: 'claude:abc', branch: 'b', starting_commit: A, plan: 'p' });
    return { service, p, claimToken: c.claim.token };
}

// Mimics the capability contract: payload = structuredContent; errors are {code,...}.
function fakeMcp(service, calls, failures) {
    const watchers = [];
    const callTool = async (server, tool, input) => {
        calls.push({ server, tool, input });
        if (failures.code) throw { code: failures.code, message: 'simulated' };
        try {
            const result = await service.call(tool, input);
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result }, payload: { result } };
        } catch (e) { throw { code: 'tool_error', message: e.message }; }
    };
    return {
        watchers,
        api: Object.freeze({
            callTool,
            watchTool(server, tool, input, handler) {
                const w = { server, tool, input, handler, live: true, refresh: () => callTool(server, tool, input).then(result => w.live && handler({ type: 'data', result }), error => w.live && handler({ type: 'error', error })) };
                watchers.push(w);
                setTimeout(w.refresh, 0);
                return () => { w.live = false; };
            },
            invalidate: async () => { for (const w of watchers.filter(x => x.live)) await w.refresh(); },
        }),
    };
}

async function load(html, { claude } = {}) {
    const dom = new JSDOM(html, {
        runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://artifact.test/',
        beforeParse(window) {
            Object.defineProperty(window, 'crypto', { value: webcrypto });
            if (claude) window.claude = claude;
        },
    });
    await tick(20);
    return dom;
}

const page = () => template.replace('__COGUMI_MCP_SERVER__', SERVER);
const text = (dom, id) => dom.window.document.getElementById(id).textContent;

test('live board renders state columns, freshness and redacted cards from the host server', async () => {
    const { service, claimToken } = await tracker();
    const calls = [], failures = {};
    const mcp = fakeMcp(service, calls, failures);
    const dom = await load(page(), { claude: { use: async n => (n === 'mcp' ? mcp.api : null) } });
    await tick(30);
    const doc = dom.window.document;
    assert.equal(text(dom, 'project-name'), 'Live Board');
    assert.match(text(dom, 'status-text'), /^Live · updated/);
    const columns = [...doc.querySelectorAll('#columns > .column-head h2')].map(h => h.textContent);
    assert.deepEqual(columns, ['Draft', 'Backlog', 'Ready', 'Implementing', 'Verifying', 'Ready to ship', 'Shipped', 'Blocked', 'Needs rework']);
    const implementing = doc.querySelector('.epic-lane[aria-label="Onboarding · Implementing"]');
    assert.match(implementing.textContent, /S1/);
    assert.match(implementing.textContent, /Claimed: claude:abc/);
    assert.ok(!doc.body.innerHTML.includes(claimToken), 'lease token never reaches the page');
    assert.ok(calls.every(c => c.server === SERVER));
    assert.deepEqual([...new Set(calls.map(c => c.tool))].sort(), ['board_overview', 'list_projects']);
    assert.equal(mcp.watchers[0].tool, 'board_overview');
    // A filter re-renders locally without new calls; the phase filter re-watches the server.
    doc.getElementById('search').value = 'nothing-matches';
    doc.getElementById('search').dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelectorAll('.card').length, 0);
    dom.window.close();
    service.close();
});

test('disconnects retract board data and explain the desktop-app requirement (scenario 10)', async () => {
    const { service } = await tracker();
    const calls = [], failures = {};
    const mcp = fakeMcp(service, calls, failures);
    const dom = await load(page(), { claude: { use: async () => mcp.api } });
    await tick(30);
    failures.code = 'server_not_connected';
    await mcp.watchers[0].refresh();
    const doc = dom.window.document;
    assert.equal(text(dom, 'status-text'), 'Not connected to the local tracker');
    assert.match(text(dom, 'notice'), /Claude desktop app/);
    assert.equal(doc.querySelectorAll('.card').length, 0);
    assert.doesNotMatch(text(dom, 'epics'), /Onboarding/);
    // A transient failure keeps the last good data and labels it stale.
    failures.code = null;
    await mcp.watchers[0].refresh();
    assert.match(text(dom, 'status-text'), /^Live/);
    failures.code = 'server_unavailable';
    await mcp.watchers[0].refresh();
    assert.match(text(dom, 'status-text'), /refresh failed/);
    assert.ok(doc.querySelectorAll('.card').length > 0);
    dom.window.close();
    service.close();
});

test('page opened outside Claude shows the not-connected state without errors', async () => {
    const dom = await load(page());
    assert.equal(text(dom, 'status-text'), 'Not connected');
    assert.match(text(dom, 'notice'), /Open this board in Claude/);
    dom.window.close();
});

test('rework from the board sends one report with a stable event id and withdraws completion (REW 01)', async () => {
    const { service, p } = await tracker();
    const calls = [], failures = {};
    const mcp = fakeMcp(service, calls, failures);
    const dom = await load(page(), { claude: { use: async () => mcp.api } });
    await tick(30);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.card')].find(c => c.textContent.startsWith('S1')).click();
    await tick(30);
    assert.match(doc.getElementById('sheet').textContent, /Save profile/);
    assert.equal(doc.activeElement.textContent, 'Close');
    const fill = (id, v) => { doc.getElementById(id).value = v; };
    fill('rw-reason', '   ');
    doc.querySelector('form.rework').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await tick(10);
    assert.ok(!calls.some(c => c.tool === 'request_rework'), 'whitespace-only summary is not sent');
    fill('rw-reason', 'Profile not kept'); fill('rw-observed', 'Gone after reload'); fill('rw-expected', 'Still there');
    doc.getElementById('rw-reason').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    failures.code = 'server_unavailable'; // outcome unknown: must not create a second report
    doc.querySelector('form.rework').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await tick(10);
    failures.code = null;
    doc.querySelector('form.rework').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await tick(40);
    const sent = calls.filter(c => c.tool === 'request_rework');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].input.event_id, sent[1].input.event_id, 'resend reuses the same event id');
    assert.equal(sent[1].input.observed, 'Gone after reload');
    assert.equal(sent[1].input.expected, 'Still there');
    const d = await service.call('story_detail', { project_id: p.id, story_id: 'S1' });
    assert.equal(d.status, 'Needs rework');
    assert.equal(d.rework.length, 1);
    assert.match(doc.getElementById('sheet').textContent, /Rework report saved/);
    dom.window.close();
    service.close();
});

test('snapshot mode renders embedded data, is labeled, and never calls a server', async () => {
    const { service, p } = await tracker();
    const html = await renderSnapshot(service, template, p.id);
    const dom = await load(html);
    const doc = dom.window.document;
    assert.match(text(dom, 'status-text'), /Snapshot captured .* not live/);
    assert.equal(doc.getElementById('refresh').disabled, true);
    assert.equal(doc.querySelectorAll('.card').length, 2);
    doc.getElementById('phase-select').value = 'MVP';
    doc.getElementById('phase-select').dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelectorAll('.card').length, 1);
    doc.querySelector('.card').click();
    await tick(10);
    assert.match(doc.getElementById('sheet').textContent, /This is a snapshot/);
    dom.window.close();
    service.close();
});


test('Codex loopback board renders local stories and refreshed changes without Claude capability', async () => {
    const { serveLocalBoard } = await import('../src/server/local-board.ts');
    const { service, p } = await tracker();
    const board = await serveLocalBoard(template, { service });
    const html = await (await fetch(board.url)).text();
    const dom = new JSDOM(html, {
        runScripts: 'dangerously', pretendToBeVisual: true, url: board.url,
        beforeParse(window) { window.fetch = (url, options) => fetch(new URL(url, board.url), options); }
    });
    try {
        await tick(100);
        const doc = dom.window.document;
        assert.match(doc.getElementById('columns').textContent, /Save profile/);
        assert.match(doc.getElementById('status-text').textContent, /Live/);
        await service.call('update_status', { project_id: p.id, story_id: 'S2', event_id: 'local-refresh', status: 'Backlog' });
        doc.getElementById('refresh').click();
        await tick(100);
        assert.match(doc.getElementById('columns').textContent, /Later/);
        const card = doc.querySelector('[data-story-id]');
        // The local transport must expose no write route.
        assert.equal((await fetch(board.url + 'api/request_rework')).status, 404);
    } finally { dom.window.close(); await new Promise(resolve => board.server.close(resolve)); }
});

test('board surfaces tracking gaps separately from lifecycle completion', async () => {
 const { service } = await tracker();
 const calls=[],failures={}; const mcp=fakeMcp(service,calls,failures);
 const dom=await load(template,{claude:{use:async()=>mcp.api}});
 try {
  await tick(30);
  assert.match(dom.window.document.getElementById('notice').textContent,/tracking gaps/);
  assert.match(dom.window.document.getElementById('notice').textContent,/No delivery milestone report/);
  assert.match(dom.window.document.title || template,/Cogumi Kanban/);
 } finally {dom.window.close();service.close();}
});
test('board shows completion, epic lanes, readiness blockers and hides source hash',async()=>{
 const {service,p}=await tracker();let dom;
 try{
  const hash='6d6ed39ef3b13cc2d5c1524b580a4413046d78c11f8bca48dd1fdd89e8407db4';const {board,revision}=await service.readBoard();board.projects[0].requirement_source={source:'PRD v1.7',revision:hash};await service.writeBoard(board,revision);
  dom=await load(await renderSnapshot(service,template,p.id));const doc=dom.window.document;
  assert.match(doc.getElementById('epic-completion-count').textContent,/0 of 1 epics implemented/);assert.equal(doc.querySelectorAll('.epic-lane-title').length,1);assert.equal(doc.querySelectorAll('.epic-lane').length,9);assert.ok(!doc.body.textContent.includes('Verification plan missing'));assert.ok(!doc.getElementById('coverage').textContent.includes(hash));
 }finally{dom?.window.close();service.close();}
});
