// Static board snapshot: the Artifact page with embedded, credential-free data.
import type { KanbanService } from './service.ts';

export const SNAPSHOT_MARKER = '<!--COGUMI_SNAPSHOT-->';

// JSON inside <script> must not be able to close the element or open a comment.
export function embedJson(value: unknown) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export async function renderSnapshot(service: KanbanService, template: string, projectId: string) {
    if (!template.includes(SNAPSHOT_MARKER)) throw Error('Board template is missing the snapshot marker');
    const projects = await service.call('list_projects');
    const overview = await service.call('board_overview', { project_id: projectId });
    // One overview per phase keeps epic completion phase-specific without live calls.
    const overviews: Record<string, unknown> = { '': overview };
    for (const phase of overview.phases) overviews[phase] = await service.call('board_overview', { project_id: projectId, phase });
    const details: Record<string, unknown> = {};
    for (const story of overview.stories) details[story.id] = await service.call('story_detail', { project_id: projectId, story_id: story.id });
    const data = { mode: 'snapshot', captured_at: new Date().toISOString(), projects: projects.filter((p: any) => p.id === projectId).map((p: any) => ({ id: p.id, name: p.name })), project_id: projectId, overviews, details };
    // A replacer function: "$&" sequences in the data must not be treated as patterns.
    const page = template.replace(SNAPSHOT_MARKER, () => `<script id="cogumi-snapshot" type="application/json">${embedJson(data)}</script>`);
    // The template is an Artifact body (the Artifact host adds the document skeleton);
    // a standalone file needs its own so browsers render in standards mode.
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`;
}
