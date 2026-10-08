// Single entry point for every caller (MCP server, reporter transport, CLI, hook).
import { runWithDb } from '../engine/persistence.ts';
import { readActions, type Actor } from '../engine/engine.ts';
import { tools as engineTools } from '../engine/tools.ts';
import { openStore, isTransient, type Store } from './store.ts';
import { BOARD_KEY, ownerActor } from './identity.ts';
import { boardOverview, storyDetail } from './views.ts';

const s = { type: 'string' };
// Redacted read models for the Artifact board and for compact context in Claude.
export const viewTools = [
    { name: 'board_overview', title: 'board overview', description: 'Compact, credential-free board for one project: cards per lifecycle state, epic/phase summary, eligibility reasons and next eligible work. Use for the Kanban board and quick status; use get_board only when full records are needed.', inputSchema: { type: 'object', properties: { project_id: s, phase: s }, required: ['project_id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: 'story_detail', title: 'story detail', description: 'Credential-free proof detail for one story: criteria, proof plan, runs, evidence (output truncated), releases, rework and recent history.', inputSchema: { type: 'object', properties: { project_id: s, story_id: s }, required: ['project_id', 'story_id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
];
export const tools = [...engineTools, ...viewTools];
export const toolNames = tools.map(t => t.name);
export const readOnlyTools = [...readActions, ...viewTools.map(t => t.name)];

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export class KanbanService {
    private store: Store | null = null;
    private file?: string;
    constructor(file?: string) { this.file = file; }

    private db(): Store {
        if (!this.store) this.store = openStore(this.file);
        return this.store;
    }

    close() { this.store?.close(); this.store = null; }

    // Engine writes are compare-and-swap on one board document. On a conflict the
    // same request (same event_id) is retried: the engine deduplicates by event ID.
    async call(action: string, args: any = {}, actor: Actor = ownerActor()): Promise<any> {
        if (!toolNames.includes(action))
            throw Error('Unknown tool');
        if (action === 'board_overview' || action === 'story_detail') {
            const project = await this.call('get_board', { project_id: args.project_id }, actor);
            return action === 'board_overview' ? boardOverview(project, args.phase || undefined) : storyDetail(project, args.story_id);
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < 6; attempt++) {
            try {
                return await runWithDb(this.db(), BOARD_KEY, action, args, actor);
            } catch (error) {
                lastError = error;
                if (!isTransient(error)) throw error;
                if (/unable to open/i.test(String((error as any)?.message))) { this.close(); }
                await pause(25 * 2 ** attempt + Math.random() * 25);
            }
        }
        throw lastError;
    }

    // Whole-board read/write used only by the importer and exporter.
    async readBoard(): Promise<{ board: any; revision: number | null }> {
        const row = await this.db().prepare('SELECT revision,data FROM boards WHERE owner=?').bind(BOARD_KEY).first();
        return row ? { board: JSON.parse(row.data), revision: row.revision } : { board: { projects: [], events: {} }, revision: null };
    }

    async writeBoard(board: any, revision: number | null) {
        const db = this.db();
        if (revision === null) {
            await db.prepare('INSERT INTO boards(owner,revision,data) VALUES(?,1,?)').bind(BOARD_KEY, JSON.stringify(board)).run();
            return;
        }
        const r = await db.prepare('UPDATE boards SET data=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(board), BOARD_KEY, revision).run();
        if (r.meta.changes !== 1) throw Error('Concurrent update; retry import');
    }
}
