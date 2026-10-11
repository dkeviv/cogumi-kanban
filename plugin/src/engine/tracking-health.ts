import { lastProgress } from './delivery-control.ts';
// Observations only: missing results are never converted into passes or releases.
export function trackingHealth(project: any, now = Date.now()) {
    const issues: any[] = [];
    const counts:any={};for(const s of project.stories)if(s.claim)counts[s.claim.worker]=(counts[s.claim.worker]||0)+1;
    for (const s of project.stories) {
        if (s.exclusion || s.proposal_pending || ['Draft', 'Backlog', 'Ready'].includes(s.status)) continue;
        const add = (code: string, message: string) => issues.push({ story_id: s.id, code, message });
        if(s.claim&&counts[s.claim.worker]>(project.workflow?.wip_limit||1))add('wip_over_limit','Worker has multiple unfinished claims; finish or reconcile existing attempts before claiming more.');
        const progress=lastProgress(s);
        if(s.claim&&Date.parse(s.claim.expires)>now&&progress&&now-Date.parse(progress)>(project.workflow?.stall_minutes||30)*60000)add('stalled_progress','No meaningful recorded progress; inspect the worker and next corrective task. Lease renewals do not count.');
        if (s.claim && Date.parse(s.claim.expires) <= now) add('expired_claim', 'Interrupted: claim expired; reconcile with the worker before recovery.');
        const runs = (s.runs || []).filter((r: any) => r.attempt_id === s.attempt_id && r.generation === s.generation && r.criterion_revision === s.revision);
        const evidence = (s.evidence || []).filter((e: any) => runs.some((r: any) => r.id === e.run_id));
        if (!s.commit) add('candidate_missing', 'No exact candidate commit recorded.');
        if (!runs.length) add('evidence_missing', 'No checks registered for the current attempt; implementation is unverified.');
        for (const r of runs) if (!evidence.some((e: any) => e.run_id === r.id)) add('outcome_unknown', `Run ${r.id} started but has no recorded result; inspect the journal before replay.`);
        if (runs.some((r: any) => r.dirty) || evidence.some((e: any) => e.dirty)) add('dirty_evidence', 'Checks used uncommitted changes; rerun against the exact clean candidate.');
        if (runs.some((r: any) => s.commit && r.commit !== s.commit)) add('outdated_evidence', 'Recorded checks target a different candidate commit.');
        if (['Verifying', 'Ready to ship', 'Shipped'].includes(s.status) && !(s.releases || []).some((r: any) => r.attempt_id === s.attempt_id && r.commit === s.commit && r.result === 'succeeded')) add('release_pending', 'No matching successful release recorded.');
        if (s.report_health?.pending_events) add('pending_reports', `${s.report_health.pending_events} result events awaiting delivery.`);
        if (s.report_health?.delivery_error) add('delivery_error', 'Result delivery failed; inspect and replay the durable outbox.');
    }
    return { issues, healthy: issues.length === 0, limitation: 'Direct commands outside the tracked runner are not intercepted. No recorded proof means unverified.' };
}
