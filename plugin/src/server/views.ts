// Compact, credential-free read models for the board Artifact and for Claude's context.
// get_board returns every evidence output and lease token; these views do not.
import { trackingHealth } from '../engine/tracking-health.ts';
import { states, summary, eligibility } from '../engine/engine.ts';
import { redactValues } from '../engine/checkpoints.ts';

const clip = (value: unknown, max: number) => typeof value === 'string' && value.length > max ? value.slice(0, max) + `… [${value.length - max} more characters]` : value;

function publicClaim(claim: any) {
    if (!claim) return null;
    const { token: _token, ...rest } = claim;
    return { ...rest, expired: Date.parse(claim.expires) <= Date.now() };
}

export function eligibleNow(project: any, story: any) {
    return story.status === 'Ready' && !!project.approval?.phases?.includes(story.phase) && !story.proposal_pending && !story.exclusion
        && (story.dependencies || []).every((id: string) => project.stories.some((x: any) => x.id === id && x.status === 'Shipped' && eligibility(project, x).deployed));
}

function card(project: any, s: any) {
    const last = s.history?.at(-1);
    // The engine closes reports with closed_at / resolved_at timestamps.
    const openRework = (s.rework || []).filter((r: any) => !r.closed_at && !r.resolved_at);
    return {
        id: s.id, title: s.title, epic: s.epic, phase: s.phase, priority: s.priority, status: s.status,
        blocker: s.blocker || s.blocked?.reason || null,
        dependencies: s.dependencies || [],
        claim: publicClaim(s.claim),
        actor: last?.actor || null, last_action: last?.action || null,
        updated_at: s.updated_at || last?.at || null,
        commit: s.commit || null,
        proposal_pending: !!s.proposal_pending, excluded: !!s.exclusion,
        open_rework: openRework.length,
        eligibility: eligibility(project, s),
        eligible_next: eligibleNow(project, s),
    };
}

// Views redact again on the way out, so records stored before redaction existed
// (for example an imported board) never reach the board page unredacted.
export function boardOverview(project: any, phase?: string) {
    return redactValues(overview(project, phase));
}

// Requirement coverage for the board (PRD COV 01): which requirements are unmapped,
// which are excluded, and the source revision they came from.
function coverage(project: any, phase?: string) {
    const unmapped = new Set(summary(project, phase).unmapped);
    const reqs = (project.requirements || []).filter((r: any) => !phase || r.phase === phase);
    const item = (r: any) => ({ id: r.id, epic: r.epic, phase: r.phase, text: r.text || null, source_revision: r.source_revision || null, review_reason: r.review_reason || null });
    return {
        source: project.requirement_source || null,
        total: reqs.length,
        unmapped: reqs.filter((r: any) => unmapped.has(r.id)).map(item),
        references: reqs.filter((r:any)=>r.classification==='reference').map(item),
        cross_cutting: reqs.filter((r:any)=>r.cross_cutting && r.classification!=='reference').map((r:any)=>({...item(r),stories:r.stories})),
        excluded: reqs.filter((r: any) => r.exclusion).map((r: any) => ({ ...item(r), reason: r.exclusion.reason })),
    };
}

function overview(project: any, phase?: string) {
    const stories = project.stories.filter((s: any) => !phase || s.phase === phase);
    return {
        generated_at: new Date().toISOString(),
        states,
        project: { id: project.id, name: project.name, binding: project.binding, bindings: project.bindings || [project.binding], scope: project.scope, approval: project.approval || null, delivery_mode: project.workflow?.delivery_mode || 'auto', strict_checks: !!project.workflow?.strict_checks },
        phases: [...new Set(project.stories.map((s: any) => s.phase))].sort(),
        epics: [...new Set(project.stories.map((s: any) => s.epic))].sort(),
        summary: summary(project, phase),
        coverage: coverage(project, phase),
        stories: stories.map((s: any) => card(project, s)),
        rejections: (project.rejections || []).slice(-20),
        last_reconciliation: project.reconciliations?.at(-1) || null,
        tracking_health: trackingHealth({ ...project, stories }),
    };
}

export function storyDetail(project: any, storyId: string) {
    return redactValues(detail(project, storyId));
}

function detail(project: any, storyId: string) {
    const s = project.stories.find((x: any) => x.id === storyId);
    if (!s) throw Error('Story not found');
    return {
        ...card(project, s),
        criteria: s.criteria,
        proof_plan: s.proof_plan,
        revision: s.revision,
        attempt_id: s.attempt_id || null,
        waivers: s.waivers || [],
        runs: (s.runs || []).slice(-50),
        evidence: (s.evidence || []).slice(-50).map((e: any) => ({ ...e, output: clip(e.output, 2000), error: clip(e.error, 2000) })),
        release: s.release || null,
        releases: s.releases || [],
        rework: s.rework || [],
        history: (s.history || []).slice(-50),
        source_path: s.source_path, source_revision: s.source_revision, requirement_ids: s.requirement_ids || [],
    };
}
