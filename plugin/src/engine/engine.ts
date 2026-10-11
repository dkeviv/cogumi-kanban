import { milestones, trackingQueue, progressHealth } from './progress.ts';
import { deliveryControl } from './delivery-control.ts';
import { trackingHealth } from './tracking-health.ts';
import { z } from 'zod';
import { assertCredentialFree } from './checkpoints.ts';
export const states = ['Draft', 'Backlog', 'Ready', 'Implementing', 'Verifying', 'Ready to ship', 'Shipped', 'Blocked', 'Needs rework'];
export type Actor = {
    id: string;
    role: 'owner' | 'reporter';
    project_id?: string;
    story_id?: string;
    attempt_id?: string;
};
export type Story = any;
export type Project = any;
export type Board = {
    projects: Project[];
    events?: Record<string, any>;
};
export { workflowGuide as guide } from './workflow-guide.ts';
import { workflowGuide as guide } from './workflow-guide.ts';
const str = z.string().trim().min(1).max(8000), id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/), commit = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/i), strings = z.array(str).max(200);
const check = z.object({ id, kind: z.enum(['functional', 'deployed']), command: str, assertions: strings.min(1) }).strict();
const proof = z.object({ type: z.enum(['browser', 'api', 'integration', 'logic', 'human', 'model']), expected: str, evidence_requirement: str.optional(), checks: z.array(check).max(50).optional() }).strict();
const storySchema = z.object({ id, epic: str, title: str, phase: str.default('MVP'), priority: z.number().int().min(0).max(10000).default(100), criteria: strings.min(1), proof_plan: z.array(proof).max(200).optional(), dependencies: z.array(id).max(200).default([]), source_path: z.string().max(1000).optional(), source_revision: z.string().max(1000).optional(), requirement_ids: z.array(id).max(200).optional() }).strict();
const runSchema = z.object({ kind: z.enum(['functional', 'deployed']), commit, command: str, environment: str, criteria: z.array(z.number().int().min(0)).min(1).max(200), verification_types: z.array(proof.shape.type).min(1).max(6), mocked: z.boolean(), dirty: z.boolean(), release_version: str.optional(), check_ids: z.array(id).optional() });
const evidenceSchema = z.object({ run_id: str, attempt_id: str, criterion_revision: z.number().int().positive(), commit, end_commit: commit, dirty: z.boolean(), mocked: z.boolean(), result: z.enum(['pass', 'fail', 'blocked']), exit_code: z.number().int().nullable(), signal: z.string().nullable().optional(), error: z.string().max(8000).optional(), output: z.string().max(64000).optional(), artifact: z.string().url().max(2000).optional(), finished_at: z.string().datetime().optional(), assertions: z.array(z.object({ check_id:id, name:str, result:z.enum(['pass','fail','blocked']) }).strict()).max(1000).optional() }).strict();
function req(v: any, t: string): asserts v {
    if (!v)
        throw Error(t);
}
function uid() { return crypto.randomUUID(); }
function owner(actor: Actor) { req(actor.role === 'owner', 'Owner permission required'); }
function phaseAllowed(p: Project, s: Story) { req(p.approval?.phases.includes(s.phase), 'Phase not approved'); }
function withdrawIntake(p:Project,s:Story,intake:any,decision:string,reason:string,now:Date){
    if(!s.proposal_pending||s.claim||s.status!=='Draft'){
        const attempt=s.attempts.find((x:any)=>x.id===s.claim?.attempt_id);if(attempt){attempt.ended_at=now.toISOString();attempt.end_reason='intake '+decision;}
        s.claim=undefined;s.generation++;s.status='Draft';s.proposal_pending=true;s.version++;s.history.push({action:'intake_withdrawn',decision,reason,at:now.toISOString(),actor:intake.decisions.at(-1)?.actor});
    }
    for(const requirement of p.requirements.filter((r:any)=>r.source_path===`intake:${intake.id}`&&!r.exclusion))requirement.exclusion={reason:'Intake '+decision+': '+reason,actor:intake.decisions.at(-1)?.actor,at:now.toISOString(),intake_withdrawal:intake.id};
}
function migrate(b: Board,now:Date) {
    b.events ||= {};
    for (const p of b.projects) {
        p.bindings ||= [p.binding];
        p.threads ||= [];
        p.intakes ||= [];
        p.sessions ||= [];
        p.workflow ||= { strict_checks: false };
        p.workflow.delivery_mode ||= 'auto';
        p.requirements ||= [];
        p.reconciliations ||= [];
        p.audit ||= [];
        p.eventRecords ||= {};
        for (const s of p.stories) {
            s.waivers ||= [];
            if (!s.revision) {
                s.revision = 1;
                s.generation = 1;
                s.runs = [];
                s.attempts = [];
                s.rework = [];
                s.releases = s.release ? [s.release] : [];
                s.proof_plan ||= [];
                s.criterion_ids = s.criteria.map((_: any, i: number) => `${s.id}:1:${i}`);
                s.claim = undefined;
                if (!['Draft', 'Backlog', 'Blocked'].includes(s.status)) {
                    s.status = 'Draft';
                    s.history.push({ at: new Date().toISOString(), action: 'migration', reason: 'Legacy proof requires registered runs and scope review' });
                    s.version++;
                }
            }
        }
        for(const intake of p.intakes){const latest=intake.decisions?.at(-1);if(latest&&latest.decision!=='approved')for(const s of p.stories.filter((s:Story)=>intake.stories.includes(s.id)))withdrawIntake(p,s,intake,latest.decision,latest.reason||'Owner withdrawal',now);}
    }
}
function graph(stories: Story[]) {
    const known = new Map(stories.map(s => [s.id, s]));
    const visiting = new Set(), done = new Set();
    function visit(s: Story) {
        if (done.has(s.id))
            return;
        req(!visiting.has(s.id), 'Dependency cycle');
        visiting.add(s.id);
        for (const d of s.dependencies) {
            req(known.has(d), `Unknown dependency: ${d}`);
            visit(known.get(d));
        }
        visiting.delete(s.id);
        done.add(s.id);
    }
    for (const s of stories)
        visit(s);
}
function active(st: Story, a: any, now: Date) { const c = st.claim; req(c && c.worker === a.worker && c.token === a.lease_token && c.attempt_id === a.attempt_id, 'Active worker lease required'); req(Date.parse(c.expires) > now.getTime(), 'Lease expired; reconcile and recover'); req(c.generation === st.generation, 'Attempt superseded'); }
function currentRun(s: Story, r: any) { return r.attempt_id === s.attempt_id && r.criterion_revision === s.revision && r.generation === s.generation && r.commit === s.commit; }
export function eligibility(p: Project, s: Story) {
    const reasons: string[] = [];
    if (!p.approval?.phases.includes(s.phase))
        reasons.push('Phase not approved');
    if (s.proposal_pending || s.exclusion) reasons.push('Scope is proposed or excluded');
    if (s.source_review)
        reasons.push('Source requirement review unresolved');
    if (s.report_health?.conflict) reasons.push('Observed checkout conflicts with candidate source');
    if (s.report_health?.dirty) reasons.push('Observed checkout contains uncommitted source changes');
    if (s.report_health?.pending_events) reasons.push('Pending report delivery');
    if (!s.commit)
        reasons.push('No exact candidate commit');
    if (!s.attempt_id)
        reasons.push('No current attempt');
    if (s.proof_plan.length !== s.criteria.length)
        reasons.push('Missing criterion proof plan');
    function covers(kind: string) {
        return s.criteria.every((_: any, i: number) => {
            if (s.waivers?.some((w: any) => w.criterion_index === i && w.criterion_revision === s.revision && w.generation === s.generation && w.kinds.includes(kind) && p.approval?.environments.includes(w.environment) && (kind !== 'deployed' || w.environment === s.release?.environment)))
                return true;
            const checks = s.proof_plan[i]?.checks?.filter((c:any) => c.kind === kind) || [];
            const baseRuns = s.runs.filter((r:any)=>currentRun(s,r)&&p.approval?.environments.includes(r.environment)&&r.kind===kind&&r.criteria.includes(i)&&(kind!=='deployed'||(r.release_id===s.release?.id&&r.release_version===s.release?.version&&r.environment===s.release?.environment)));
            const qualifies=(r:any,c?:any)=>{if(!r)return false;const e=s.evidence.find((v:any)=>v.run_id===r.id);return e?.output!==undefined&&(!e.assertions||e.assertions.every((a:any)=>a.result==='pass')&&new Set(e.assertions.map((a:any)=>JSON.stringify([a.check_id,a.name]))).size===e.assertions.length)&&e.result==='pass'&&e.exit_code===0&&!e.signal&&!e.error&&!e.dirty&&!e.mocked&&!r.dirty&&!r.mocked&&e.commit===r.commit&&e.end_commit===r.commit&&r.verification_types.includes(s.proof_plan[i]?.type)&&(!c||c.assertions.every((name:string)=>e.assertions?.some((v:any)=>v.check_id===c.id&&v.name===name&&v.result==='pass')));};
            if(p.workflow?.strict_checks)return checks.length>0&&checks.every((c:any)=>qualifies(baseRuns.filter((r:any)=>r.check_ids?.includes(c.id)).at(-1),c));
            return qualifies(baseRuns.at(-1));
        });
    }
    const functional = !reasons.length && covers('functional');
    if (!functional)
        reasons.push('Missing, pending or failed current functional proof');
    const release = s.release && p.approval?.environments.includes(s.release.environment) && s.release.commit === s.commit && s.release.attempt_id === s.attempt_id && s.release.generation === s.generation && s.release.result === 'succeeded';
    const deployed = functional && release && covers('deployed');
    if (!deployed)
        reasons.push('Missing matching successful release or current deployed proof');
    return { functional, deployed: !!deployed, reasons };
}
function invalidate(p: Project, s: Story) {
    if(p.workflow?.tracking_only!==false && milestones(s).reported)return;
    const e = eligibility(p, s);
    if (s.status === 'Shipped' && !e.deployed) {
        s.status = 'Needs rework';
        s.blocker = 'Current proof no longer qualifies';
    }
    else if (s.status === 'Ready to ship' && !e.functional) {
        s.status = 'Verifying';
        s.blocker = 'Current functional proof pending or failed';
    }
}
export function summary(p: Project, phase?: string) { const rs = p.requirements.filter((r: any) => r.classification !== 'reference' && (!phase || r.phase === phase)); const unmapped = rs.filter((r: any) => !r.exclusion && (!r.stories.length || r.stories.some((id: string) => !p.stories.some((s: Story) => s.id === id && (r.cross_cutting || (s.phase === r.phase && s.epic === r.epic)))))).map((r: any) => r.id); const ss = p.stories.filter((s: Story) => !phase || s.phase === phase); const epics = [...new Set([...ss.map((s: Story) => s.epic), ...rs.filter((r:any)=>!r.cross_cutting || !r.stories.length).map((r: any) => r.epic)])].map(epic => { const children = ss.filter((s: Story) => s.epic === epic && !s.exclusion && !s.proposal_pending); const reqs = rs.filter((r: any) => r.epic === epic || (r.cross_cutting && r.stories.some((id:string)=>children.some((s:Story)=>s.id===id)))); const unresolved = reqs.filter((r: any) => unmapped.includes(r.id)); const orphan = children.filter((s: Story) => !reqs.some((r: any) => r.stories.includes(s.id))); const shipped = children.filter((s: Story) => s.status === 'Shipped' && eligibility(p, s).deployed); const counts={implemented:children.filter(s=>milestones(s).implemented).length,verified:children.filter(s=>milestones(s).verified).length,released:children.filter(s=>milestones(s).released).length}; return { ...counts, implemented_complete:children.length>0&&counts.implemented===children.length&&!unresolved.length&&!orphan.length, verified_complete:children.length>0&&counts.verified===children.length&&!unresolved.length&&!orphan.length, released_complete:children.length>0&&counts.released===children.length&&!unresolved.length&&!orphan.length, epic, total: children.length, shipped: shipped.length, remaining: children.filter((s: Story) => !shipped.includes(s)).map((s: Story) => ({ id: s.id, title: s.title, status: s.status })), unmapped: unresolved.map((r: any) => r.id), unmapped_stories: orphan.map((s: Story) => s.id), proposals:ss.filter((s:Story)=>s.epic===epic&&s.proposal_pending).map((s:Story)=>({id:s.id,title:s.title})), excluded: [...ss.filter((s: Story) => s.epic === epic && s.exclusion).map((s: Story) => ({ id: s.id, ...s.exclusion })), ...reqs.filter((r: any) => r.exclusion).map((r: any) => ({ id: r.id, ...r.exclusion }))], complete: !!p.requirement_source && reqs.length > 0 && shipped.length === children.length && !unresolved.length && !orphan.length }; }); return { epics, unmapped, coverage_registered: !!p.requirement_source }; }
export const readActions = ['workflow', 'list_projects', 'resolve_project', 'get_board', 'next_story', 'delivery_tasks', 'preview_import', 'project_metrics', 'restore_checkpoint'];
export function dispatch(board: Board, action: string, a: any, now = new Date(), actor?: Actor): any {
    req(actor?.id, 'Authenticated actor required');
    migrate(board,now);
    if (actor.role === 'reporter')
        req(['record_evidence', 'record_release', 'begin_run','checkpoint_attempt','restore_checkpoint','heartbeat_attempt'].includes(action) && actor.project_id === a.project_id && actor.story_id === a.story_id, 'Reporter permission denied');
    if (action === 'workflow')
        return { instructions: guide };
    if (action === 'list_projects')
        return board.projects.map(p => ({ id: p.id, name: p.name, binding: p.binding, bindings:p.bindings, scope: p.scope }));
    if (action === 'create_project') {
        owner(actor);
        const name = str.parse(a.name), binding = str.parse(a.binding);
        const key = id.parse(a.event_id);
        const source = a.source === undefined ? '' : str.parse(a.source), scope = a.scope === undefined ? 'No implementation authorized' : str.parse(a.scope);
        const strict_checks=a.strict_checks===undefined?true:z.boolean().parse(a.strict_checks);
        const delivery_mode=z.enum(['auto','approval']).parse(a.delivery_mode||'auto');
        const payload = JSON.stringify({ name, binding, source, scope,...(a.strict_checks===undefined?{}:{strict_checks}),...(a.delivery_mode===undefined?{}:{delivery_mode}) });
        if (board.events![key]) {
            req(board.events![key].payload === payload, 'Event ID reused with different payload');
            return board.projects.find(p => p.id === board.events![key].project_id);
        }
        req(!board.projects.some(p => p.bindings.includes(binding)), 'Binding already exists');
        const p = { id: uid(), name, binding, source, scope, stories: [], events: [], eventRecords: {}, requirements: [], reconciliations: [], audit: [{ actor: actor.id, at: now.toISOString(), action }], approval: null,workflow:{strict_checks,delivery_mode},bindings:[binding],threads:[],sessions:[],intakes:[] };
        board.projects.push(p);
        board.events![key] = { payload, project_id: p.id };
        return p;
    }
    if (action === 'resolve_project') {
        const ps = board.projects.filter(p => p.bindings.includes(a.binding));
        req(ps.length === 1, 'Binding must resolve exactly one project');
        return ps[0];
    }
    const p = board.projects.find(p => p.id === a.project_id);
    req(p, 'Project not found');
    if(action==='restore_checkpoint') {
        const st=p.stories.find((s:Story)=>s.id===a.story_id);req(st,'Story not found');
        const attempt=actor.role==='reporter'?actor.attempt_id:a.attempt_id||st.attempt_id;
        return {...(st.checkpoints?.find((x:any)=>x.attempt_id===attempt)||{attempt_id:attempt,sequence:0,events:[],journals:[]}),current_attempt:attempt===st.attempt_id&&!!st.claim&&Date.parse(st.claim.expires)>now.getTime(),unfinished_runs:st.runs.filter((r:any)=>r.attempt_id===attempt&&!st.evidence.some((e:any)=>e.run_id===r.id)),completed_run_ids:st.evidence.filter((e:any)=>e.attempt_id===attempt).map((e:any)=>e.run_id)};
    }
    if(action==='delivery_tasks')return p.workflow.tracking_only===false?deliveryControl(p,eligibility,now.getTime(),a.worker):{tracking_only:true,tasks:[],next_task:null};
    if (action === 'project_metrics') return { stories:p.stories.length, prevented_invalid_transitions:(p.rejections||[]).filter((x:any)=>x.action==='update_status').length, rejected_requests:(p.rejections||[]).length, duplicate_deliveries:p.duplicate_deliveries||0, recovery_seconds:p.audit.filter((x:any)=>x.action==='recover_claim').map((x:any)=>x.recovery_seconds).filter((x:any)=>typeof x==='number'), qualifying_criteria:p.stories.filter((s:Story)=>!s.exclusion&&!s.proposal_pending).reduce((n:number,s:Story)=>n+(eligibility(p,s).functional?s.criteria.length:0),0), required_criteria:p.stories.filter((s:Story)=>!s.exclusion&&!s.proposal_pending).reduce((n:number,s:Story)=>n+s.criteria.length,0), verified_releases:p.stories.filter((s:Story)=>eligibility(p,s).deployed).length, stale_claims:p.stories.filter((s:Story)=>s.claim&&Date.parse(s.claim.expires)<=now.getTime()).length, open_rework:p.stories.flatMap((s:Story)=>s.rework).filter((r:any)=>!r.closed_at&&!r.resolved_at).length, manual_corrections:p.audit.filter((x:any)=>['request_rework','revise_story','recover_claim'].includes(x.action)).length, recovered_claims:p.audit.filter((x:any)=>x.action==='recover_claim').length, baseline:p.metrics_baseline||null };
    if (action === 'get_board')
        return { ...p, metrics:dispatch(board,'project_metrics',{project_id:p.id},now,actor), summary: summary(p, a.phase), stories: p.stories.map((s: Story) => ({ ...s, eligibility: eligibility(p, s) })) };
    if (action === 'next_story')
        return p.stories.filter((s: Story) => s.status === 'Ready' && (p.workflow.tracking_only!==false || p.approval?.phases.includes(s.phase)) && (!a.phase || s.phase === a.phase) && !s.exclusion && s.dependencies.every((d: string) => p.stories.some((x: Story) => x.id === d && (p.workflow.tracking_only!==false?milestones(x).implemented:x.status === 'Shipped' && eligibility(p, x).deployed)))).sort((x: Story, y: Story) => x.priority - y.priority)[0] || null;
    const proposed = () => {
        req(Array.isArray(a.stories) && a.stories.length > 0 && a.stories.length <= 200, 'Provide 1 to 200 stories');
        const input: z.infer<typeof storySchema>[] = a.stories.map((x: any) => { const old = p.stories.find((s: Story) => s.id === x.id); const base = old ? Object.fromEntries(Object.keys(storySchema.shape).map(k => [k, old[k]])) : {}; return storySchema.parse({ ...base, ...x }); });
        const merged = p.stories.map((s: Story) => ({ ...s }));
        for (const x of input) {
            const i = merged.findIndex((s: Story) => s.id === x.id);
            if (i < 0)
                merged.push(x);
            else
                merged[i] = { ...merged[i], ...x };
        }
        graph(merged);
        return input;
    };
    if (action === 'preview_import') {
        owner(actor);
        const input = proposed();
        return { added: input.filter(s => !p.stories.some((x: Story) => x.id === s.id)).map(s => s.id), changed: input.filter(s => p.stories.some((x: Story) => x.id === s.id && JSON.stringify(storySchema.parse(Object.fromEntries(Object.keys(storySchema.shape).map(k => [k, x[k]])))) !== JSON.stringify(s))).map(s => s.id), retained: p.stories.filter((s: Story) => !input.some(x => x.id === s.id)).map((s: Story) => s.id) };
    }
    const event = id.parse(a.event_id);
    const payload = JSON.stringify({ action, args: { ...a, event_id: undefined }, actor: actor.id });
    if (p.eventRecords[event]) {
        req(p.eventRecords[event].payload === payload, 'Event ID reused with different payload');
        p.duplicate_deliveries=(p.duplicate_deliveries||0)+1;
        return { duplicate: true, event_id: event, result: p.eventRecords[event].result };
    }
    req(!p.events.includes(event), 'Legacy event ID has no replayable payload; reconcile before reusing it');
    const advanceQueue = () => {
        if(p.workflow.tracking_only!==false)return {moved:trackingQueue(p),backlog:[],ready:[],waiting:[]};
        const backlog:string[]=[], ready:string[]=[], waiting:any[]=[];
        for (const story of p.stories) {
            if (!p.approval?.phases.includes(story.phase) || story.exclusion || story.proposal_pending || story.source_review) continue;
            const change = (status:string) => dispatch(board,'update_status',{project_id:p.id,story_id:story.id,event_id:`${event}:queue:${story.id}:${status}`,status,reason:'Auto mode: advance unchanged approved scope through existing lifecycle gates'},now,actor);
            if (story.status==='Draft') { change('Backlog'); backlog.push(story.id); }
            if (story.status==='Backlog') {
                try { change('Ready'); ready.push(story.id); }
                catch (error) { waiting.push({story_id:story.id,reason:(error as Error).message}); }
            }
        }
        return {backlog,ready,waiting};
    };
    const save = (result: any, s?: Story, data: any = {}) => {
        if (p.workflow.delivery_mode==='auto' && (['approve_scope','import_stories','reconcile'].includes(action) || (action==='update_status' && a.status==='Shipped'))) advanceQueue();
        if(s && p.workflow.delivery_mode==='auto' && s.claim && Date.parse(s.claim.expires)>now.getTime() && p.approval?.phases.includes(s.phase)) {
            const prior=s.status;
            if(action==='begin_run' && s.status==='Implementing')s.status='Verifying';
            if(action==='record_evidence' && ['Implementing','Verifying'].includes(s.status) && eligibility(p,s).functional)s.status='Ready to ship';
            if(prior!==s.status)s.history.push({at:now.toISOString(),action:'auto_progress',actor:actor.id,from:prior,status:s.status,reason:'Recorded verification milestone'});
        }
        if(s && ['prepare_verification','revise_story','claim_story','set_commit','begin_run','record_evidence','record_release','request_rework','recover_claim'].includes(action))s.last_progress_at=now.toISOString();
        if(action==='reconcile')p.delivery_control=p.workflow.tracking_only===false?{...deliveryControl(p,eligibility,now.getTime()),assessed_at:now.toISOString()}:{tracking_only:true,tasks:[],next_task:null};
        const audit = { at: now.toISOString(), action, actor: actor.id, role: actor.role, reason: a.reason, ...data };
        p.audit.push(audit);
        if (s) {
            s.history.push(audit);
            s.version++;
            s.updated_at = now.toISOString();
        }
        p.events.push(event);
        p.eventRecords[event] = { payload, result: JSON.parse(JSON.stringify(s === result ? { id: s.id, version: s.version, status: s.status } : result)) };
        return result;
    };
    if(action==='record_progress') {
        owner(actor);str.parse(a.worker);
        const reports=z.array(z.object({story_id:id,milestone:z.enum(['started','implemented','verifying','verified','released','blocked','rework']),summary:str,references:z.array(str).default([]),blocker:z.string().optional()})).min(1).max(200).parse(a.reports);
        req(new Set(reports.map(x=>x.story_id)).size===reports.length,'Duplicate story reports');
        for(const report of reports){const s=p.stories.find((x:Story)=>x.id===report.story_id);req(s&&!s.exclusion&&!s.proposal_pending&&!s.source_review,'Story unresolved or excluded');if(s.claim&&Date.parse(s.claim.expires)>now.getTime())req(s.claim.worker===a.worker,'Live claim belongs to another worker');}
        if(p.workflow.delivery_mode==='approval' && a.approved!==true){p.progress_proposals||=[];p.progress_proposals.push({event_id:event,reports,at:now.toISOString(),worker:a.worker});return save({pending_approval:true,event_id:event});}
        for(const report of reports){const st=p.stories.find((x:Story)=>x.id===report.story_id)!;
            const record={...report,revision:st.revision,at:now.toISOString(),actor:actor.id,worker:a.worker,provenance:'agent_report'};
            st.progress_reports||=[];st.progress_reports.push(record);
            st.status=({started:'Implementing',implemented:'Verifying',verifying:'Verifying',verified:'Ready to ship',released:'Shipped',blocked:'Blocked',rework:'Needs rework'} as any)[report.milestone];
            st.blocker=report.blocker||null;st.last_progress_at=record.at;st.updated_at=record.at;st.version++;
            st.history.push({action:'record_progress',...record});
        }
        const queue=p.workflow.delivery_mode==='auto'?trackingQueue(p):[];
        return save({recorded:reports.map(x=>x.story_id),queue,summary:summary(p)});
    }
    if (action==='set_delivery_mode') {
        owner(actor); const mode=z.enum(['auto','approval']).parse(a.mode); str.parse(a.reason);
        p.workflow.delivery_mode=mode;
        p.workflow.mode_decision={mode,reason:a.reason,actor:actor.id,at:now.toISOString()};
        return save({mode,queue:mode==='auto'?advanceQueue():{backlog:[],ready:[],waiting:[]}});
    }
    if (action==='advance_queue') {
        owner(actor);req(p.workflow.delivery_mode==='auto','Queue automation requires Auto mode');
        return save(advanceQueue());
    }
    if (action==='classify_requirements') {
        owner(actor);str.parse(a.reason);
        const entries=z.array(z.object({id,classification:z.enum(['reference','requirement']),stories:z.array(id),cross_cutting:z.boolean()})).min(1).max(1000).parse(a.entries);
        req(new Set(entries.map(x=>x.id)).size===entries.length,'Duplicate classification IDs');
        for (const entry of entries) {
            req(p.requirements.some((r:any)=>r.id===entry.id),'Requirement not found: '+entry.id);
            req(entry.classification!=='reference'||entry.stories.length===0,'Reference material cannot map to delivery stories');
            req(entry.stories.every(storyId=>p.stories.some((s:Story)=>s.id===storyId)),'Unknown mapped story');
        }
        for (const entry of entries) {
            const r=p.requirements.find((r:any)=>r.id===entry.id);
            r.mapping_history ||= [];r.mapping_history.push({stories:r.stories,classification:r.classification||'requirement',cross_cutting:!!r.cross_cutting,at:now.toISOString(),actor:actor.id,reason:a.reason});
            Object.assign(r,{classification:entry.classification,stories:entry.stories,cross_cutting:entry.cross_cutting});
        }
        return save({classified:entries.length,summary:summary(p)});
    }
    if (action === 'add_binding') {
        owner(actor);const binding=str.parse(a.binding);str.parse(a.reason);
        req(!board.projects.some(x=>x.id!==p.id&&x.bindings.includes(binding)), 'Binding already belongs to another project');
        if(!p.bindings.includes(binding))p.bindings.push(binding);
        return save({bindings:p.bindings});
    }
    if (action === 'associate_thread') {
        owner(actor);req(p.bindings.includes(a.binding),'Repository binding mismatch');
        const thread_id=id.parse(a.thread_id);const t=p.threads.find((x:any)=>x.thread_id===thread_id);
        if(t){t.last_seen_at=now.toISOString();t.binding=a.binding;}else p.threads.push({thread_id,binding:a.binding,at:now.toISOString(),last_seen_at:now.toISOString(),actor:actor.id});
        return save(p.threads.find((x:any)=>x.thread_id===thread_id));
    }
    if(action==='start_session') {
        owner(actor);req(p.bindings.includes(a.binding),'Repository binding mismatch');const thread_id=id.parse(a.thread_id),observed_commit=commit.parse(a.commit),pending_events=z.number().int().min(0).parse(a.pending_events),rejected_events=a.rejected_events===undefined?undefined:z.number().int().min(0).parse(a.rejected_events);
        const session={id:uid(),thread_id,binding:a.binding,commit:observed_commit,pending_events,...(rejected_events===undefined?{}:{rejected_events}),at:now.toISOString(),actor:actor.id,unfinished_runs:p.stories.flatMap((s:Story)=>s.runs.filter((r:any)=>!s.evidence.some((e:any)=>e.run_id===r.id)).map((r:any)=>({story_id:s.id,run_id:r.id}))),known_releases:p.stories.flatMap((s:Story)=>s.releases.map((r:any)=>({story_id:s.id,version:r.version,result:r.result,commit:r.commit})))};
        p.sessions.push(session);if(!p.threads.some((t:any)=>t.thread_id===thread_id))p.threads.push({thread_id,binding:a.binding,at:now.toISOString(),actor:actor.id});
        const reconciliation={...session,staleClaims:p.stories.filter((s:Story)=>s.claim&&Date.parse(s.claim.expires)<=now.getTime()).map((s:Story)=>s.id),repairs:[],conflicts:[]};p.reconciliations.push(reconciliation);
        return save({...session,summary:summary(p),next_story:pending_events===0?dispatch(board,'next_story',{project_id:p.id},now,actor):null});
    }
    if (action === 'configure_workflow') {
        owner(actor);str.parse(a.reason);p.workflow={...p.workflow,strict_checks:z.boolean().parse(a.strict_checks),...(a.wip_limit===undefined?{}:{wip_limit:z.number().int().min(1).max(20).parse(a.wip_limit)}),...(a.stall_minutes===undefined?{}:{stall_minutes:z.number().int().min(1).max(1440).parse(a.stall_minutes)})};
        for(const s of p.stories)invalidate(p,s);
        return save(p.workflow);
    }
    if(action==='approve_proposal') {owner(actor);str.parse(a.reason);const proposal=p.stories.find((s:Story)=>s.id===a.story_id);req(proposal?.proposal_pending,'Pending proposal required');req(!proposal.intake_id,'Intake proposals require decide_intake approval');proposal.proposal_pending=false;proposal.status='Backlog';p.requirements.push({id:`PROPOSAL-${proposal.id}`,epic:proposal.epic,phase:proposal.phase,stories:[proposal.id],text:proposal.criteria.join('\n'),source_path:`report:${proposal.origin_report_id||proposal.intake_id}`,source_revision:event});return save(proposal,proposal);}
    if(action==='import_source_bundle') {
        owner(actor);str.parse(a.reason);const bundle=a.bundle;req(bundle&&typeof bundle==='object','Source bundle required');
        const source=str.parse(bundle.source),revision=str.parse(bundle.source_revision);
        req(bundle.format?.name==='standard-markdown'&&typeof bundle.format.version==='string'&&bundle.format.version.trim()&&bundle.format.verified===true,'Verified installed OpenSpec format/version required');
        req(Array.isArray(bundle.requirements)&&bundle.requirements.length>0&&Array.isArray(bundle.stories),'Full source inventory and mapped stories required');
        const mappings={source,revision,format:bundle.format,project_id:p.id,scenarios:bundle.scenarios||[],tasks:bundle.tasks||[],mapping_history:bundle.mapping_history||[],delta:bundle.delta||{},at:now.toISOString(),actor:actor.id};
        assertCredentialFree(mappings);
        // Nested writes share the enclosing D1 CAS transaction; no partial DB import.
        let imported:any={added:0,changed:0,unchanged:0};
        if(bundle.stories.length)imported=dispatch(board,'import_stories',{project_id:p.id,event_id:event+':stories',stories:bundle.stories,source,source_revision:revision,reason:a.reason},now,actor);
        const requirements=bundle.requirements.map((r:any)=>({id:r.id,epic:r.epic,phase:r.phase,stories:r.stories,text:r.text,source_path:r.source_path,source_revision:revision,classification:r.classification,cross_cutting:r.cross_cutting}));
        dispatch(board,'set_requirements',{project_id:p.id,event_id:event+':coverage',requirements,source,source_revision:revision},now,actor);
        p.source_mappings ||= [];p.source_mappings.push(mappings);return save({imported,source_revision:revision,summary:summary(p)});
    }
    if (action === 'capture_baseline') {
        owner(actor);str.parse(a.reason);const metrics=dispatch(board,'project_metrics',{project_id:p.id},now,actor);delete metrics.baseline;p.metrics_baseline={at:now.toISOString(),actor:actor.id,metrics};return save(p.metrics_baseline);
    }
    if (action === 'propose_intake') {
        owner(actor);const request=str.parse(a.request),goal=str.parse(a.goal);const input=proposed();
        req(input.every(x=>!p.stories.some((s:Story)=>s.id===x.id)),'Use a reviewed criterion revision for existing story; preserve original scope');
        const intake={id:uid(),request,goal,source_revision:a.source_revision||event,stories:input.map(x=>x.id),decisions:[],at:now.toISOString(),actor:actor.id};
        for(const x of input)p.stories.push({...x,proof_plan:x.proof_plan||[],proposal_pending:true,status:'Draft',revision:1,generation:1,version:1,criterion_ids:x.criteria.map((_,i)=>`${x.id}:1:${i}`),history:[{action:'intake',request,at:now.toISOString(),actor:actor.id}],runs:[],attempts:[],rework:[],releases:[],evidence:[],waivers:[],source_revision:intake.source_revision,intake_id:intake.id,updated_at:now.toISOString()});
        p.intakes.push(intake);return save(intake);
    }
    if (action === 'decide_intake') {
        owner(actor);const intake=p.intakes.find((x:any)=>x.id===a.intake_id);req(intake,'Intake not found');
        const decision=z.enum(['approved','rejected','needs_clarification']).parse(a.decision);const reason=str.parse(a.reason);
        intake.decisions.push({decision,reason,at:now.toISOString(),actor:actor.id});
        if(decision==='approved')for(const s of p.stories.filter((s:Story)=>intake.stories.includes(s.id)&&s.status==='Draft')){s.status='Backlog';s.proposal_pending=false;s.version++;s.history.push({action:'intake_approved',reason,at:now.toISOString(),actor:actor.id});if(!p.requirements.some((r:any)=>r.stories.includes(s.id)))p.requirements.push({id:`INTAKE-${s.id}`,epic:s.epic,phase:s.phase,stories:[s.id],text:s.criteria.join('\n'),source_path:`intake:${intake.id}`,source_revision:intake.source_revision});}
        if(decision!=='approved')for(const s of p.stories.filter((s:Story)=>intake.stories.includes(s.id)))withdrawIntake(p,s,intake,decision,reason,now);
        if(decision==='approved')for(const requirement of p.requirements.filter((r:any)=>r.exclusion?.intake_withdrawal===intake.id))delete requirement.exclusion;
        if(decision==='approved'&&!p.requirement_source)p.requirement_source={source:'Reviewed informal intake',revision:intake.source_revision};
        return save(intake);
    }
    if (action === 'approve_scope') {
        owner(actor);
        const prior = p.approval;
        p.approval = { phases: strings.min(1).parse(a.phases), environments: strings.min(1).parse(a.environments), reason: str.parse(a.reason), actor: actor.id, at: now.toISOString() };
        p.scope = `${p.approval.phases.join(', ')} · ${p.approval.environments.join(', ')}`;
        for (const s of p.stories) {
            if (prior && (JSON.stringify(prior.phases) !== JSON.stringify(p.approval.phases) || JSON.stringify(prior.environments) !== JSON.stringify(p.approval.environments))) {
                s.generation++;
                if (s.claim) {
                    s.claim = undefined;
                    s.status = 'Blocked';
                    s.blocker = 'Scope changed; review and claim new attempt';
                }
                s.history.push({ action: 'scope_invalidation', at: now.toISOString(), actor: actor.id, reason: a.reason });
                s.version++;
            }
            invalidate(p, s);
        }
        return save(p.approval);
    }
    if (action === 'set_requirements') {
        owner(actor);
        const requirements = z.array(z.object({ id, epic: str, phase: str, stories: z.array(id).max(200), source_path: z.string().max(1000).optional(), text: z.string().max(32000).optional(), source_revision: z.string().max(1000).optional(), classification:z.enum(['reference','requirement']).optional(),cross_cutting:z.boolean().optional() })).min(1).max(1000).parse(a.requirements).map(r=>{
            const prior=p.requirements.find((x:any)=>x.id===r.id);
            // An unchanged legacy import cannot erase an audited classification repair.
            if(prior?.mapping_history?.length && prior.text===r.text && prior.source_revision===a.source_revision && r.classification===undefined)
                return {...r,classification:prior.classification,cross_cutting:prior.cross_cutting,stories:r.stories.length?r.stories:prior.stories};
            return r;
        });
        req(new Set(requirements.map(r => r.id)).size === requirements.length, 'Duplicate requirement IDs');
        const source = str.parse(a.source), revision = str.parse(a.source_revision);
        for (const r of requirements) {
            const old = p.requirements.find((x: any) => x.id === r.id);
            if ((!old && r.stories.some(storyId => p.stories.some((st: Story) => st.id === storyId && (st.status !== 'Draft' || st.source_revision !== revision)))) || (old && (old.text !== r.text || old.source_path !== r.source_path || old.phase !== r.phase || old.epic !== r.epic || JSON.stringify(old.stories) !== JSON.stringify(r.stories)))) {
                for (const storyId of new Set([...(old?.stories || []), ...r.stories])) {
                    const st = p.stories.find((s: Story) => s.id === storyId);
                    if (st) {
                        st.generation++;
                        st.claim = undefined;
                        st.status = 'Draft';
                        st.source_review = `Changed requirement ${r.id} at ${revision}; reconcile criteria through revise_story`;
                        st.history.push({ action: 'requirement_changed', at: now.toISOString(), actor: actor.id, requirement: r.id, source_revision: revision });
                        st.version++;
                    }
                }
            }
        }
        const missing = p.requirements.filter((r: any) => !requirements.some(x => x.id === r.id));
        p.requirement_history ||= [];
        p.requirement_history.push({ requirements: p.requirements, source: p.requirement_source, at: now.toISOString() });
        p.requirements = requirements.map(r => ({ ...r, mapping_history:p.requirements.find((x:any)=>x.id===r.id)?.mapping_history, source_revision: revision }));
        for (const r of missing)
            p.requirements.push({ ...r, stories: [], review_reason: 'Removed from source; explicit owner exclusion required' });
        p.requirement_source = { source, revision };
        return save({ requirements: p.requirements, summary: summary(p) });
    }
    if (action === 'exclude_requirement') {
        owner(actor);
        const r = p.requirements.find((r: any) => r.id === a.requirement_id);
        req(r, 'Requirement not found');
        r.exclusion = { reason: str.parse(a.reason), actor: actor.id, at: now.toISOString() };
        return save(r);
    }
    if (action === 'import_stories') {
        owner(actor);
        const input = proposed();
        const counts = { added: 0, changed: 0, unchanged: 0 };
        for (const x of input) {
            let s = p.stories.find((s: Story) => s.id === x.id);
            if (!s) {
                s = { ...x, status: 'Draft', revision: 1, generation: 1, version: 1, criterion_ids: x.criteria.map((_, i) => `${x.id}:1:${i}`), proof_plan: x.proof_plan || [], waivers: [], evidence: [], runs: [], attempts: [], releases: [], rework: [], history: [], source: a.source || p.source, source_revision: a.source_revision || x.source_revision };
                p.stories.push(s);
                counts.added++;
            }
            else {
                const before = storySchema.parse(Object.fromEntries(Object.keys(storySchema.shape).map(k => [k, s[k]])));
                if (JSON.stringify(before) === JSON.stringify(x)) {
                    counts.unchanged++;
                    continue;
                }
                s.history.push({ at: now.toISOString(), actor: actor.id, action: 'source_revision', snapshot: Object.fromEntries(Object.keys(storySchema.shape).map(k => [k, s[k]])), reason: a.reason || 'Imported source changed' });
                Object.assign(s, x, { proof_plan: x.proof_plan || [], status: 'Draft', claim: undefined, source_review: undefined, revision: s.revision + 1, generation: s.generation + 1 });
                s.criterion_ids = s.criteria.map((_: any, i: number) => `${s.id}:${s.revision}:${i}`);
                s.source_revision = a.source_revision || x.source_revision;
                counts.changed++;
            }
            s.history.push({ at: now.toISOString(), actor: actor.id, action: 'import', source: a.source || p.source });
            s.updated_at = now.toISOString();
        }
        return save(counts);
    }
    if (action === 'reconcile') {
        owner(actor);
        const commitValue = a.commit === undefined ? undefined : commit.parse(a.commit);
        const r = { id: uid(), at: now.toISOString(), actor: actor.id, commit: commitValue, pending_events: a.pending_events, staleClaims: p.stories.filter((s: Story) => s.claim && Date.parse(s.claim.expires) <= now.getTime()).map((s: Story) => s.id), blocked: p.stories.filter((s: Story) => ['Blocked', 'Needs rework'].includes(s.status)).map((s: Story) => ({ id: s.id, reason: s.blocker })), repairs: [] as any[], conflicts: [] as any[], ...summary(p, a.phase) };
        for (const s of p.stories) {
            const previous = s.status;
            invalidate(p, s);
            if (previous !== s.status) {
                s.history.push({ action: 'reconcile_repair', at: now.toISOString(), actor: actor.id, previous, status: s.status });
                s.version++;
                r.repairs.push({ story: s.id, previous, status: s.status });
            }
            if (s.claim && commitValue && s.commit !== commitValue)
                r.conflicts.push({ story: s.id, reason: 'Observed checkout differs from candidate' });
        }
        (r as any).tracking_health = p.workflow.tracking_only===false?trackingHealth(p, now.getTime()):progressHealth(p,now.getTime());
        p.reconciliations.push(r);
        return save(r);
    }
    const st = p.stories.find((s: Story) => s.id === a.story_id);
    req(st, 'Story not found');
    if (actor.role === 'reporter' && action !== 'record_evidence')
        req(actor.attempt_id === st.attempt_id, 'Reporter permission denied for superseded attempt');
    if (a.expected_version !== undefined)
        req(a.expected_version === st.version, 'Version conflict; reread story');
    const endAttempt = (reason: string) => {
        if (st.claim) {
            const attempt = st.attempts.find((x: any) => x.id === st.claim.attempt_id);
            if (attempt) {
                attempt.ended_at = now.toISOString();
                attempt.end_reason = reason;
            }
        }
        st.claim = undefined;
    };
    if(action==='heartbeat_attempt') {
        req(a.attempt_id===st.attempt_id&&st.claim&&Date.parse(st.claim.expires)>now.getTime(),'Active current attempt required');
        if(actor.role==='owner')active(st,a,now);
        st.claim.expires=new Date(now.getTime()+3600000).toISOString();
        st.claim.heartbeat_at=now.toISOString();return save({expires:st.claim.expires,attempt_id:st.attempt_id},st);
    }
    if(action==='checkpoint_attempt') {
        req(a.attempt_id===st.attempt_id&&st.claim&&Date.parse(st.claim.expires)>now.getTime(),'Active current attempt required; superseded checkpoints are read-only');
        req(p.bindings.includes(a.binding),'Repository binding mismatch');
        const cp=z.object({sequence:z.number().int().positive(),commit,dirty:z.boolean().default(false),pending_events:z.number().int().min(0),events:z.array(z.any()).max(100),journals:z.array(z.any()).max(100),delivery_error:z.string().max(1000).optional(),stage:z.enum(['start','resume','before_test','after_test','after_deploy','before_close','heartbeat']).optional()}).parse(a);
        assertCredentialFree(cp);
        req(cp.pending_events===cp.events.length,'Pending count must match saved events');
        for(const e of cp.events){req(['record_evidence','record_release','begin_run'].includes(e.action)&&e.args?.project_id===p.id&&e.args?.story_id===st.id,'Checkpoint event outside reporter scope');id.parse(e.args.event_id);if(e.action==='record_evidence')req(st.runs.some((r:any)=>r.id===e.args.evidence?.run_id&&r.attempt_id===st.attempt_id),'Checkpoint result must belong to registered attempt');}
        st.checkpoints ||= [];const previous=st.checkpoints.find((x:any)=>x.attempt_id===st.attempt_id);
        req(!previous||cp.sequence>previous.sequence,'Checkpoint sequence must advance');
        const next={...cp,attempt_id:st.attempt_id,at:now.toISOString(),actor:actor.id};
        if(previous)st.checkpoints[st.checkpoints.indexOf(previous)]=next;else st.checkpoints.push(next);
        st.report_health={at:now.toISOString(),pending_events:cp.pending_events,delivery_error:cp.delivery_error,conflict:cp.commit!==st.commit,dirty:cp.dirty,observed_commit:cp.commit,stage:cp.stage};
        const before=st.status;invalidate(p,st);
        const reconciliation={id:uid(),at:now.toISOString(),actor:actor.id,story_id:st.id,attempt_id:st.attempt_id,commit:cp.commit,pending_events:cp.pending_events,stage:cp.stage,repairs:before===st.status?[]:[{story:st.id,previous:before,status:st.status}],conflicts:cp.commit===st.commit?[]:[{story:st.id,reason:'Observed checkout differs from candidate'}]};
        p.reconciliations.push(reconciliation);
        return save(next,st,{reconciliation_id:reconciliation.id});
    }
    if (action === 'waive_criterion') {
        owner(actor);
        phaseAllowed(p, st);
        const w = z.object({ criterion_index: z.number().int().min(0), criterion_revision: z.number().int().positive(), kinds: z.array(z.enum(['functional', 'deployed'])).min(1), reason: str, environment: str }).parse(a);
        req(w.criterion_index < st.criteria.length && w.criterion_revision === st.revision && p.approval.environments.includes(w.environment), 'Current criterion revision and approved environment required');
        st.waivers ||= [];
        st.waivers.push({ ...w, generation: st.generation, actor: actor.id, at: now.toISOString() });
        return save(st, st, { waiver: w });
    }
    if (action === 'revise_story') {
        owner(actor);
        str.parse(a.reason);
        const next = storySchema.parse({ id: st.id, epic: a.epic || st.epic, title: a.title || st.title, phase: a.phase || st.phase, priority: a.priority ?? st.priority, criteria: a.criteria || st.criteria, proof_plan: a.proof_plan || st.proof_plan, dependencies: a.dependencies || st.dependencies, source_path: st.source_path });
        graph(p.stories.map((s: Story) => s === st ? next : s));
        const old = Object.fromEntries(Object.keys(storySchema.shape).map(k => [k, st[k]]));
        Object.assign(st, next);
        st.source_review = undefined;
        st.revision++;
        st.generation++;
        st.criterion_ids = st.criteria.map((_: any, i: number) => `${st.id}:${st.revision}:${i}`);
        endAttempt('criterion revision');
        st.status = 'Draft';
        return save(st, st, { snapshot: old });
    }
    if (action === 'exclude_story') {
        owner(actor);
        str.parse(a.reason);
        // PRD COV 01: deferring a required story states the revised phase scope (the phase
        // it moves to, or "removed"); required on strict projects.
        const deferred_to = a.deferred_to === undefined ? undefined : str.parse(a.deferred_to);
        if (p.workflow?.strict_checks) req(deferred_to, 'deferred_to (the phase the story moves to, or "removed") is required');
        st.exclusion = { reason: a.reason, actor: actor.id, at: now.toISOString(), from_phase: st.phase, ...(deferred_to ? { deferred_to } : {}) };
        endAttempt('deferred');
        st.generation++;
        st.status = 'Draft';
        return save(st, st);
    }
    if(action==='prepare_verification') {
        owner(actor);str.parse(a.reason);req(!st.claim,'Finish or reconcile the existing attempt before changing its verification plan');
        req(st.revision===a.criterion_revision,'Criteria changed; assess the current revision');
        const plans=z.array(proof).min(1).parse(a.proof_plan);req(plans.length===st.criteria.length,'Every criterion needs a verification plan');
        req(plans.every(v=>v.evidence_requirement&&['functional','deployed'].every(kind=>v.checks?.some(c=>c.kind===kind))),'Real functional/deployed commands, assertions and evidence requirements required');
        st.proof_plan=plans;
        if(p.workflow.delivery_mode==='auto')advanceQueue();
        return save(st,st);
    }
    if (action === 'claim_story') {
        const wipWorker=str.parse(a.worker);
        req(p.stories.filter((s:Story)=>s.id!==st.id&&s.claim?.worker===wipWorker).length<(p.workflow.wip_limit||1),'Work-in-progress limit reached: finish or reconcile your existing claim first');
        owner(actor);
        req(p.bindings.includes(a.binding), 'Repository binding mismatch');
        req(st.status === 'Ready' && !st.claim && !st.exclusion, 'Story must be Ready and unclaimed');
        if(p.workflow.strict_checks)req(p.sessions.some((x:any)=>x.binding===a.binding&&x.commit===a.starting_commit&&x.pending_events===0&&!x.rejected_events&&now.getTime()-Date.parse(x.at)<900000),'Reconciled start/resume session required before claim (fresh, same commit, no pending or unresolved rejected events)');
        phaseAllowed(p, st);
        req(st.dependencies.every((d: string) => p.stories.some((s: Story) => s.id === d && s.status === 'Shipped' && eligibility(p, s).deployed)), 'Dependencies unfinished');
        const worker = str.parse(a.worker), branch = str.parse(a.branch), starting = commit.parse(a.starting_commit), plan = str.parse(a.plan);
        const attempt = { id: uid(), worker, branch, starting_commit: starting, plan, generation: ++st.generation, criterion_revision: st.revision, started_at: now.toISOString(), rework_ids: st.rework.filter((r: any) => !r.closed_at).map((r: any) => r.id) };
        st.attempts.push(attempt);
        st.attempt_id = attempt.id;
        st.claim = { worker, attempt_id: attempt.id, generation: st.generation, token: uid(), expires: new Date(now.getTime() + 3600000).toISOString() };
        st.status = 'Implementing';
        return save(st, st, { attempt });
    }
    if (action === 'renew_claim') {
        owner(actor);
        active(st, a, now);
        st.claim.expires = new Date(now.getTime() + 3600000).toISOString();
        return save(st, st);
    }
    if (action === 'recover_claim') {
        owner(actor);
        req(st.claim && Date.parse(st.claim.expires) <= now.getTime(), 'Only stale claims can be recovered');
        const r = p.reconciliations.find((r: any) => r.id === a.reconciliation_id);
        req(r && r.commit && r.pending_events === 0 && r.staleClaims.includes(st.id) && Date.parse(r.at) >= Date.parse(st.claim.expires) && r.commit === (st.commit || st.attempts.at(-1)?.starting_commit), 'Recent matching source/outbox reconciliation required');
        str.parse(a.reason);
        const recovery_seconds=Math.max(0,(now.getTime()-Date.parse(st.claim.expires))/1000);
        endAttempt('owner recovered stale claim');
        st.generation++;
        st.status = 'Backlog';
        return save(st, st,{recovery_seconds});
    }
    if (action === 'set_commit') {
        owner(actor);
        active(st, a, now);
        req(['Implementing', 'Verifying', 'Ready to ship'].includes(st.status), 'Cannot change source in current state');
        const nextCommit = commit.parse(a.commit);
        if (st.commit && st.commit !== nextCommit) {
            st.generation++;
            st.claim.generation = st.generation;
        }
        st.commit = nextCommit;
        if(st.report_health)st.report_health.conflict=st.report_health.observed_commit!==nextCommit;
        st.status = 'Implementing';
        return save(st, st, { commit: st.commit });
    }
    if (action === 'begin_run') {
        req(p.bindings.includes(a.binding), 'Repository binding mismatch');
        if (actor.role === 'owner' && st.status !== 'Shipped')
            active(st, a, now);
        else if (actor.role === 'reporter')
            req(st.claim && Date.parse(st.claim.expires) > now.getTime(), 'Active attempt required');
        phaseAllowed(p, st);
        const x = runSchema.parse(a);
        req(x.commit === st.commit, 'Run must name current candidate commit');
        req(p.approval.environments.includes(x.environment), 'Environment not approved');
        req(x.criteria.every(i => i < st.criteria.length), 'Invalid criterion index');
        req(st.proof_plan.length === st.criteria.length && x.criteria.every(i => x.verification_types.includes(st.proof_plan[i].type)), 'Verification type does not match criterion proof plan');
        if(p.workflow.strict_checks)req(x.criteria.every(i => {const checks=st.proof_plan[i].checks?.filter((c:any)=>c.kind===x.kind&&x.check_ids?.includes(c.id))||[];return checks.length&&checks.every((c:any)=>c.command===x.command)}),'Run must execute reviewed check mapping');
        if (x.kind === 'deployed')
            req(st.release?.version === x.release_version && st.release.commit === x.commit && st.release.environment === x.environment, 'Run must target matching release');
        const r = { ...x, check_plan:p.workflow.strict_checks?x.criteria.flatMap(i=>(st.proof_plan[i].checks||[]).filter((c:any)=>c.kind===x.kind&&x.check_ids?.includes(c.id))):[], release_id: x.kind === 'deployed' ? st.release.id : undefined, target_url: x.kind === 'deployed' ? st.release.url : undefined, id: uid(), sequence: st.runs.length + 1, attempt_id: st.attempt_id, criterion_revision: st.revision, generation: st.generation, started_at: now.toISOString(), criterion_ids: x.criteria.map(i => st.criterion_ids[i]) };
        st.runs.push(r);
        invalidate(p, st);
        return save(r, st, { run_id: r.id });
    }
    if (action === 'record_evidence') {
        const e = evidenceSchema.parse(a.evidence);
        req(!e.assertions||new Set(e.assertions.map(x=>JSON.stringify([x.check_id,x.name]))).size===e.assertions.length,'Duplicate or contradictory assertion outcomes');
        req(e.result!=='pass'||!e.assertions?.some(x=>x.result!=='pass'),'Passing evidence cannot contain failed or blocked assertions');
        const r = st.runs.find((r: any) => r.id === e.run_id);
        req(r, 'Evidence requires a registered run');
        req(e.attempt_id === r.attempt_id && e.criterion_revision === r.criterion_revision && e.commit === r.commit, 'Run provenance mismatch');
        if (actor.role === 'reporter')
            req(actor.attempt_id === r.attempt_id, 'Reporter permission denied');
        req(!st.evidence.some((x: any) => x.run_id === e.run_id), 'Run result immutable; register a new run');
        req(e.output !== undefined || e.artifact, 'Output (including empty) or artifact required');
        req(e.result !== 'pass' || e.exit_code === 0, 'Pass requires exit code zero');
        if(r.check_plan?.length&&e.result==='pass')req(r.check_plan.every((c:any)=>c.assertions.every((name:string)=>e.assertions?.some((v:any)=>v.check_id===c.id&&v.name===name&&v.result==='pass'))),'Passing proof requires all reviewed assertion outcomes');
        st.evidence.push({ ...r, ...e, id: event, received_at: now.toISOString(), at: now.toISOString() });
        invalidate(p, st);
        return save(st, st, { run_id: r.id });
    }
    if (action === 'record_release') {
        if (actor.role === 'owner')
            active(st, a, now);
        else
            req(st.claim && Date.parse(st.claim.expires) > now.getTime(), 'Active attempt required');
        phaseAllowed(p, st);
        const x = z.object({ commit, version: str, url: z.string().url().refine(v => v.startsWith('https://')), environment: str, result: z.enum(['succeeded', 'failed']),provider:str.optional(),deployment_id:str.optional() }).strict().parse(a.release);
        req(x.commit === st.commit && p.approval.environments.includes(x.environment), 'Release source/environment not approved');
        const priorRelease = st.releases.find((r: any) => r.version === x.version && r.environment === x.environment);
        req(!priorRelease || (priorRelease.url === x.url && priorRelease.commit === x.commit), 'Release identity conflict: version already names another deployment');
        const r = { ...x, attempt_id: st.attempt_id, generation: st.generation, at: now.toISOString(), id: uid() };
        st.releases.push(r);
        st.release = r;
        invalidate(p, st);
        return save(st, st, { release: r });
    }
    const makeProposal=(r:any)=>{
            const proposal_id=`SCOPE-${uid()}`;r.proposal_story_id=proposal_id;
            p.stories.push({id:proposal_id,epic:st.epic,title:`Proposed: ${r.expected}`.slice(0,8000),phase:st.phase,priority:st.priority,criteria:[r.expected],proof_plan:[],dependencies:[],proposal_pending:true,status:'Draft',revision:1,generation:1,version:1,criterion_ids:[`${proposal_id}:1:0`],history:[{action:'scope_proposal',report_id:r.id,origin_story_id:st.id,at:now.toISOString(),actor:actor.id}],runs:[],attempts:[],rework:[],releases:[],evidence:[],waivers:[],origin_story_id:st.id,origin_report_id:r.id,updated_at:now.toISOString()});
    };
    if(action==='classify_rework') {
        owner(actor);const r=st.rework.find((x:any)=>x.id===a.report_id&&!x.closed_at&&!x.resolved_at);req(r&&r.classification==='ambiguous','Open ambiguous rework report required');
        const classification=z.enum(['unmet','regression','new_scope']).parse(a.classification),reason=str.parse(a.reason);
        r.classification_history ||= [];r.classification_history.push({previous:r.classification,classification,reason,at:now.toISOString(),actor:actor.id});r.classification=classification;
        endAttempt('rework clarified');st.generation++;r.reproduction_generation=st.generation;r.criterion_revision=st.revision;r.reproductions=[];
        if(classification==='new_scope')makeProposal(r);else r.corrective_story_id=st.id;
        st.status='Needs rework';st.blocker=r.reason;return save(r,st);
    }
    if (action === 'request_rework') {
        owner(actor);
        const r:any = { id: uid(), reason: str.parse(a.reason), observed: a.observed || a.reason, expected: a.expected || 'Approved acceptance behavior', classification: z.enum(['unmet', 'regression', 'new_scope', 'ambiguous']).parse(a.classification || 'unmet'), reproduction:a.reproduction===undefined?undefined:str.parse(a.reproduction), reproductions:[], previous_status:st.status, at: now.toISOString(), actor: actor.id, release: st.release };
        st.rework.push(r);
        endAttempt('human rework');
        if(r.classification==='new_scope') makeProposal(r);else {st.generation++;r.corrective_story_id=st.id;}
        r.reproduction_generation=st.generation;r.criterion_revision=st.revision;
        st.status = 'Needs rework';
        st.blocker = r.reason;
        return save(st, st, { report: r });
    }
    if(action==='record_reproduction') {
        owner(actor);const r=st.rework.find((x:any)=>x.id===a.report_id&&!x.closed_at&&!x.resolved_at);req(r,'Open rework report required');
        const reproduction=z.object({method:z.enum(['manual','automated']),result:z.enum(['fail','blocked']),details:str,run_id:str.optional()}).parse(a);
        if(reproduction.method==='automated')req(st.evidence.some((e:any)=>e.run_id===reproduction.run_id&&e.result==='fail'&&e.criterion_revision===st.revision&&e.generation>=(r.reproduction_generation||0)&&Date.parse(e.received_at)>=Date.parse(r.at)),'Current report reproduction requires an actual failing run after the report');
        r.reproductions ||= [];r.reproductions.push({...reproduction,report_id:r.id,criterion_revision:st.revision,generation:st.generation,at:now.toISOString(),actor:actor.id});return save(r,st);
    }
    if(action==='resolve_rework_scope') {
        owner(actor);const r=st.rework.find((x:any)=>x.id===a.report_id&&!x.closed_at&&!x.resolved_at);req(r&&r.classification==='new_scope','Additional-scope report required');str.parse(a.reason);req(a.decision==='additional_scope','Only explicit additional-scope resolution supported');
        r.resolved_at=now.toISOString();r.resolution={decision:a.decision,reason:a.reason,actor:actor.id};
        if(!st.rework.some((x:any)=>!x.closed_at&&!x.resolved_at)){st.status=st.rework.some((x:any)=>x.previous_status==='Shipped')&&eligibility(p,st).deployed?'Shipped':'Backlog';st.blocker=undefined;}
        return save(st,st,{report_id:r.id});
    }
    if (action === 'update_status') {
        owner(actor);
        const target = z.enum(states as [
            string,
            ...string[]
        ]).parse(a.status);
        if(target===st.status && ['Verifying','Ready to ship'].includes(target)) {
            active(st,a,now);phaseAllowed(p,st);
            req(target==='Verifying'?st.commit:eligibility(p,st).functional,'Current verification milestone required');
            return save(st,st,{status:target});
        }
        if (target === 'Blocked') {
            str.parse(a.reason);
            st.blocked = { previous: st.status, next_action: a.next_action || 'Owner reconciliation required', dependency: a.dependency || 'unknown' };
            st.blocker = a.reason;
            st.status = 'Blocked';
            return save(st, st, { status: target });
        }
        if (target === 'Draft') {
            str.parse(a.reason);
            endAttempt('draft');
            st.generation++;
            st.status = 'Draft';
            return save(st, st, { status: target });
        }
        req(!st.proposal_pending,'Proposal must be approved before execution');
        // Blocked resumes to the exact state it interrupted (the gates of that state still
        // apply: lease, proof, release), or goes back to Backlog to end the attempt.
        const resumable = ['Ready', 'Implementing', 'Verifying', 'Ready to ship', 'Shipped'].includes(st.blocked?.previous) ? [st.blocked.previous] : [];
        const transitions: Record<string, string[]> = { Draft: ['Backlog'], Backlog: ['Ready'], Implementing: ['Verifying'], Verifying: ['Implementing', 'Ready to ship'], 'Ready to ship': ['Implementing', 'Shipped'], 'Needs rework': ['Backlog'], Blocked: ['Backlog', ...resumable] };
        req(transitions[st.status]?.includes(target), 'Invalid transition; claim Ready stories before coding');
        if (target === 'Backlog')
            endAttempt('backlog');
        if (target === 'Ready') {
            phaseAllowed(p, st);
            str.parse(a.reason);
            req(!st.exclusion && !st.proposal_pending && !st.source_review && st.proof_plan.length === st.criteria.length, 'Reviewed scope and testable criterion proof plan required');
            if(p.workflow.strict_checks)req(st.proof_plan.every((v:any)=>v.evidence_requirement&&['functional','deployed'].every(kind=>v.checks?.some((c:any)=>c.kind===kind))),'Evidence requirements and reviewed functional/deployed checks required');
            req(st.dependencies.every((d: string) => p.stories.some((s: Story) => s.id === d && s.status === 'Shipped' && eligibility(p, s).deployed)), 'Dependencies unfinished');
        }
        if (['Implementing', 'Verifying', 'Ready to ship', 'Shipped'].includes(target)) {
            active(st, a, now);
            phaseAllowed(p, st);
            if (target === 'Verifying')
                req(st.commit, 'Candidate commit required');
        }
        if (target === 'Ready to ship')
            req(eligibility(p, st).functional, 'All criteria need current real passing functional evidence');
        if (target === 'Shipped') {
            req(eligibility(p, st).deployed, 'Matching successful release and deployed evidence required');
            req(!st.rework.some((r:any)=>!r.closed_at&&!r.resolved_at&&['new_scope','ambiguous'].includes(r.classification)), 'Owner must resolve additional or ambiguous scope before closure');
            if(p.workflow.strict_checks)req(st.report_health?.stage==='before_close'&&st.report_health.pending_events===0&&p.reconciliations.some((r:any)=>r.story_id===st.id&&r.attempt_id===st.attempt_id&&r.stage==='before_close'&&st.evidence.filter((e:any)=>currentRun(st,e)).every((e:any)=>Date.parse(r.at)>=Date.parse(e.received_at))),'Current before-close reconciliation required');
            if(p.workflow.strict_checks)req(st.rework.filter((r:any)=>!r.closed_at&&!r.resolved_at&&r.classification!=='new_scope').every((r:any)=>r.reproductions?.some((v:any)=>v.report_id===r.id&&v.criterion_revision===st.revision&&v.generation>=(r.reproduction_generation||0)&&Date.parse(v.at)>=Date.parse(r.at))),'Rework requires failing-check or honest manual reproduction record');
            for (const r of st.rework)
                if (!r.closed_at&&!r.resolved_at) {
                    r.closed_at = now.toISOString();
                    r.corrective_attempt = st.attempt_id;
                    r.corrective_revision=st.revision;r.corrective_commit=st.commit;
                    r.release = st.release;
                }
            endAttempt('shipped');
        }
        if (st.status === 'Blocked') st.blocked = { ...st.blocked, resolved_at: now.toISOString(), resolved_to: target };
        st.status = target;
        st.blocker = undefined;
        return save(st, st, { status: target, commit: st.commit });
    }
    throw Error('Unknown action');
}
