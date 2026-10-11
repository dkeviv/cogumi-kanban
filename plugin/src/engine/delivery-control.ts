// Deterministic corrective work derived from authoritative records. No inferred passes.
export function lastProgress(story:any) {
    return story.last_progress_at || [...(story.history||[])].reverse().find((h:any)=>['claim_story','prepare_verification','revise_story','set_commit','begin_run','record_evidence','record_release','request_rework','recover_claim','auto_progress'].includes(h.action))?.at || story.attempts?.at(-1)?.started_at || null;
}
export function deliveryControl(project:any, eligible:(p:any,s:any)=>any, now=Date.now(), worker?:string) {
    const tasks:any[]=[];
    for(const s of project.stories) {
        if(s.exclusion||s.status==='Shipped')continue;
        let kind:string, next_action:string;
        const live=s.claim&&Date.parse(s.claim.expires)>now;
        const current=(s.runs||[]).filter((r:any)=>r.attempt_id===s.attempt_id&&r.generation===s.generation&&r.criterion_revision===s.revision&&r.commit===s.commit);
        const plan=s.proof_plan?.length===s.criteria.length&&s.proof_plan.every((v:any)=>!project.workflow?.strict_checks || (v.evidence_requirement&&['functional','deployed'].every(k=>v.checks?.some((c:any)=>c.kind===k))));
        if(s.claim&&!live){kind='reconcile_claim';next_action='Verify the prior worker is interrupted, reconcile source and outbox, then recover the expired claim.';}
        else if(s.report_health?.pending_events||s.report_health?.delivery_error){kind='recover_reports';next_action='Inspect the durable journal and replay only verified interrupted reports.';}
        else if(s.source_review||s.proposal_pending){kind='assess_scope';next_action='Assess retained source changes against user constraints and record the mode-appropriate owner decision.';}
        else if(!project.approval?.phases.includes(s.phase)){kind='scope_decision';next_action='Check whether this phase belongs to the user’s requested outcome; record the decision or retain it as future work.';}
        else if(!plan){kind='prepare_verification';next_action='Inspect acceptance criteria and repository; register real commands, observable assertions and evidence requirements with prepare_verification before claiming.';}
        else if(live){
            if(!s.commit){kind='record_candidate';next_action='Finish the claimed implementation and record its exact clean candidate commit.';}
            else if(current.some((r:any)=>!s.evidence.some((e:any)=>e.run_id===r.id))){kind='recover_run';next_action='Inspect the unfinished run journal; recover an honest outcome before rerunning.';}
            else if(!eligible(project,s).functional){kind='verify_functional';next_action='Run reviewed functional checks through the tracked runner and fix recorded failures.';}
            else if(!eligible(project,s).deployed){kind='verify_release';next_action='Record the actual release and run tracked checks against that exact deployed version.';}
            else {kind='close_story';next_action='Run before-close, then mark Shipped with the current lease.';}
        } else if(s.status==='Blocked'){kind='resolve_blocker';next_action=s.blocked?.next_action||s.blocker||'Resolve the recorded blocker before resuming.';}
        else if(s.dependencies.some((id:string)=>!project.stories.some((x:any)=>x.id===id&&x.status==='Shipped'&&eligible(project,x).deployed))){kind='wait_dependency';next_action='Finish and verify the prerequisite story first.';}
        else {kind='claim_story';next_action='Advance through readiness gates and claim the next eligible story before coding.';}
        const at=lastProgress(s);const stalled=!!live&&!!at&&now-Date.parse(at)>(project.workflow?.stall_minutes||30)*60000;
        tasks.push({id:`${s.id}:${s.revision}:${s.generation}:${kind}`,story_id:s.id,kind,next_action,assigned_worker:s.claim?.worker||null,waiting_on_worker:!!live&&!!worker&&s.claim.worker!==worker,stalled,last_progress_at:at,priority:s.priority,active:!!s.claim});
    }
    const counts:any={};for(const s of project.stories)if(s.claim)counts[s.claim.worker]=(counts[s.claim.worker]||0)+1;
    const over_limit=Object.entries(counts).filter(([_,count])=>Number(count)>(project.workflow?.wip_limit||1)).map(([worker,count])=>({worker,count,limit:project.workflow?.wip_limit||1}));
    tasks.sort((a,b)=>Number(b.active)-Number(a.active)||a.priority-b.priority||a.story_id.localeCompare(b.story_id));
    return {over_limit,mode:project.workflow?.delivery_mode||'auto',wip_limit:project.workflow?.wip_limit||1,tasks,next_task:tasks.find(t=>!t.waiting_on_worker&&!['wait_dependency','scope_decision'].includes(t.kind))||null,stalled:tasks.filter(t=>t.stalled).map(t=>t.story_id)};
}
