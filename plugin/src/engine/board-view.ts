export function boardView(project:any,{phase='All phases',epic='All epics',query=''}:{phase?:string,epic?:string,query?:string}) {
    const stories=project?.stories||[];
    const eligible=(s:any)=>s.status==='Ready'&&!s.proposal_pending&&!s.exclusion&&s.dependencies.every((id:string)=>stories.some((x:any)=>x.id===id&&x.status==='Shipped'&&x.eligibility?.deployed));
    const scoped=stories.filter((s:any)=>phase==='All phases'||s.phase===phase);
    const visible=scoped.filter((s:any)=>(epic==='All epics'||s.epic===epic)&&[s.id,s.title,s.epic].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a:any,b:any)=>Number(eligible(b))-Number(eligible(a))||a.priority-b.priority||a.id.localeCompare(b.id));
    return {scoped,visible,summaries:(project?.summary?.epics||[]).filter((x:any)=>epic==='All epics'||x.epic===epic)};
}
