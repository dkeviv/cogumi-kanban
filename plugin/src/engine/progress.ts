// Reported delivery milestones are distinct from independently qualified proof.
export function milestones(s:any) {
 const reports=(s.progress_reports||[]).filter((x:any)=>x.revision===s.revision);
 const latest=reports.at(-1);
 const rank:any={started:0,implemented:1,verifying:1,verified:2,released:3,blocked:-1,rework:-1};
 const invalidated=latest && (s.history||[]).some((h:any)=>['request_rework','classify_rework','intake_withdrawn'].includes(h.action)&&Date.parse(h.at)>=Date.parse(latest.at));
 const reset=reports.map((x:any)=>x.milestone).lastIndexOf('rework');
 const value=invalidated?-1:Math.max(-1,...reports.slice(reset+1).map((x:any)=>rank[x.milestone]));
 return {implemented:value>=1,verified:value>=2,released:value>=3,reported:!!latest,latest:latest||null};
}
export function trackingQueue(p:any) {
 const moved:any[]=[];
 for(const s of p.stories) {
  if(s.exclusion||s.proposal_pending||s.source_review||!['Draft','Backlog','Ready'].includes(s.status))continue;
  if(p.approval && !p.approval.phases.includes(s.phase))continue;
  const ready=s.criteria.length>0 && (s.dependencies||[]).every((id:string)=>p.stories.some((d:any)=>d.id===id&&(d.exclusion||milestones(d).implemented)));
  const status=ready?'Ready':'Backlog';
  if(status!==s.status){moved.push({story_id:s.id,from:s.status,status});s.status=status;s.version++;}
 }
 return moved;
}
export function progressHealth(p:any,now=Date.now()) {
 return {issues:p.stories.filter((s:any)=>!s.exclusion&&!s.proposal_pending&&['Implementing','Verifying','Ready to ship'].includes(s.status)).flatMap((s:any)=>{
 const m=milestones(s);const at=m.latest?.at||s.last_progress_at||s.updated_at;
 return !m.reported?[{story_id:s.id,code:'missing_progress',message:'No delivery milestone report recorded; use record_progress.'}]:at&&now-Date.parse(at)>30*60000?[{story_id:s.id,code:'stale_progress',message:'Progress report is stale; reconcile with the delivery agent.'}]:[];
 }),blocking:false};
}
