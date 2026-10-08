// Import a board exported from the ChatGPT Sites edition (PRD MIG 01).
// Input: a JSON array of get_board results, a single get_board result, or {projects:[...]}.
import { randomUUID } from 'node:crypto';
import type { KanbanService } from './service.ts';
import { ownerActor } from './identity.ts';

const DERIVED_PROJECT_FIELDS = ['metrics', 'summary'];

export function parseExport(data: any): any[] {
    const projects = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : data && typeof data === 'object' && data.id ? [data] : null;
    if (!projects || !projects.length) throw Error('Export must be a get_board result, an array of them, or {projects:[...]}');
    for (const p of projects) {
        if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) throw Error('Every exported project needs an id');
        // Same identifier rule the engine uses for event and attempt IDs; also keeps IDs
        // safe to use in file names (snapshots, checkpoints).
        if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(p.id)) throw Error(`Project id ${JSON.stringify(p.id).slice(0, 60)} is not a valid identifier`);
        if (!Array.isArray(p.stories)) throw Error(`Project ${p.id} has no stories array; export get_board output, not list_projects`);
        if (typeof p.binding !== 'string' && !Array.isArray(p.bindings)) throw Error(`Project ${p.id} has no binding`);
    }
    const ids = projects.map((p: any) => p.id);
    if (new Set(ids).size !== ids.length) throw Error('Export contains the same project twice');
    const seen = new Map<string, string>();
    for (const p of projects)
        for (const b of new Set([...(Array.isArray(p.bindings) ? p.bindings : []), ...(p.binding ? [p.binding] : [])])) {
            if (seen.has(b as string)) throw Error(`Projects ${seen.get(b as string)} and ${p.id} in the export share binding ${b}`);
            seen.set(b as string, p.id);
        }
    return projects;
}

export function cleanProject(source: any, now = new Date()) {
    const p = structuredClone(source);
    for (const field of DERIVED_PROJECT_FIELDS) delete p[field];
    p.bindings = [...new Set([...(Array.isArray(p.bindings) ? p.bindings : []), ...(p.binding ? [p.binding] : [])])];
    p.binding ||= p.bindings[0];
    let expiredClaims = 0;
    for (const story of p.stories) {
        delete story.eligibility;
        if (story.claim) {
            // Imported in-progress work must be reconciled and recovered; the old
            // worker's lease token is replaced with one nobody holds.
            story.claim = { ...story.claim, token: randomUUID(), expires: new Date(Math.min(Date.parse(story.claim.expires) || 0, now.getTime() - 1000)).toISOString(), imported_expired: true };
            expiredClaims++;
        }
    }
    p.audit = [...(Array.isArray(p.audit) ? p.audit : []), { at: now.toISOString(), action: 'import_chatgpt_board', actor: ownerActor().id, role: 'owner', reason: 'Imported from Cogumi Kanban ChatGPT Sites export; claims expired pending reconciliation; add the local Git binding with add_binding before resuming work' }];
    p.imported_from = { edition: 'chatgpt-sites', at: now.toISOString(), bindings: [...p.bindings] };
    return { project: p, expiredClaims };
}

export async function importBoard(service: KanbanService, data: any, { replace = false } = {}) {
    const incoming = parseExport(data);
    const { board, revision } = await service.readBoard();
    board.projects ||= [];
    board.events ||= {};
    const result = { imported: [] as string[], replaced: [] as string[], unchanged: [] as string[], stories: 0, evidence: 0, releases: 0, expired_claims: 0 };
    const now = new Date();
    for (const source of incoming) {
        const existing = board.projects.findIndex((p: any) => p.id === source.id);
        const { project, expiredClaims } = cleanProject(source, now);
        const collision = board.projects.find((p: any) => p.id !== project.id && (p.bindings || [p.binding]).some((b: string) => project.bindings.includes(b)));
        if (collision) throw Error(`Binding of imported project ${project.id} already belongs to project ${collision.id}; nothing was imported`);
        if (existing >= 0 && !replace) { result.unchanged.push(project.id); continue; }
        if (existing >= 0) { board.projects[existing] = project; result.replaced.push(project.id); }
        else { board.projects.push(project); result.imported.push(project.id); }
        result.stories += project.stories.length;
        result.evidence += project.stories.reduce((n: number, s: any) => n + (s.evidence?.length || 0), 0);
        result.releases += project.stories.reduce((n: number, s: any) => n + (s.releases?.length || (s.release ? 1 : 0)), 0);
        result.expired_claims += expiredClaims;
    }
    if (result.imported.length || result.replaced.length)
        await service.writeBoard(board, revision);
    return result;
}

export async function exportBoard(service: KanbanService) {
    const { board } = await service.readBoard();
    const projects = [];
    for (const p of board.projects || []) projects.push(await service.call('get_board', { project_id: p.id }));
    return projects;
}
