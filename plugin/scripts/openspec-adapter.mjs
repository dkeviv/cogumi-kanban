import crypto from 'node:crypto';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex').slice(0,16);
const changeId=source=>source.match(/(?:^|\/)changes\/([^/]+)\//)?.[1]||null;
// Git is specification authority. IDs survive renames through explicit reviewed mappings.
export function prepareOpenSpec(files,revision,mapping={},definitions=[],options={}){
 const requirements=[],tasks=[],scenarios=[],warnings=[],stories=new Map(definitions.map(s=>[s.id,{...s,criteria:[],requirement_ids:[],dependencies:s.dependencies||[]}]));
 for(const file of files){
  const change_id=changeId(file.path);
  if(file.path.endsWith('tasks.md')){for(const line of file.content.split('\n')){const m=line.match(/^\s*- \[([ xX])\] (.+)$/);if(m){const number=m[2].match(/^([\d.]+)\s/)?.[1],key=`${file.path}#${number||m[2]}`,bound=options.task_mapping?.[key]||{};tasks.push({id:bound.id||'TASK-'+hash(key),project_id:options.project_id||null,change_id,source_path:file.path,source_revision:revision,text:m[2],checked:m[1].toLowerCase()==='x',stories:bound.stories||[],requirements:bound.requirements||[]});}}continue;}
  const content=file.content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');const matches=[...content.matchAll(/^### Requirement:\s*(.+)\s*$/gm)];
  if(!matches.length)throw Error(`Unsupported OpenSpec format in ${file.path}; verify installed format before importing.`);
  for(let i=0;i<matches.length;i++){
   const m=matches[i],title=m[1].trim(),key=`${file.path}#${title}`,binding=mapping[key]||{};
   const next=matches[i+1]?.index||content.length;let body=content.slice(m.index+m[0].length,next).trim();body=body.split(/^##\s+(?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/m)[0].trim();
   const section=[...content.slice(0,m.index).matchAll(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/gm)].at(-1)?.[1]||'BASE',removed=section==='REMOVED';
   const requirement={id:binding.id||'OSP-'+hash(key),epic:binding.epic||'OpenSpec coverage review',phase:binding.phase||'MVP',stories:removed?[]:(binding.stories||[]),source_path:key,text:title+'\n'+body,source_revision:revision,project_id:options.project_id||null,change_id,operation:section};
   if(requirements.some(r=>r.id===requirement.id))throw Error(`Duplicate requirement ${requirement.id}; import a reviewed resolved inventory, not overlapping base and change specs`);
   requirements.push(requirement);if(removed)warnings.push(`${key}: removed source requirement requires owner review/exclusion`);else if(!binding.stories?.length)warnings.push(`${key}: unmapped requirement`);
   const matchesScenario=[...body.matchAll(/^#### Scenario:\s*(.+)\s*$/gm)];const refs=matchesScenario.map((x,j)=>{const name=x[1].trim(),text=body.slice(x.index+x[0].length,matchesScenario[j+1]?.index||body.length).trim();const ref={id:binding.scenarios?.[name]?.id||'SC-'+hash(requirement.id+'#'+name),name,text,requirement_id:requirement.id,project_id:options.project_id||null,change_id,source_path:key+'#'+name,source_revision:revision};scenarios.push(ref);return ref;});
   for(const storyId of requirement.stories){const s=stories.get(storyId);if(!s)throw Error(`Mapping names unknown story ${storyId}`);if(s.epic!==requirement.epic||s.phase!==requirement.phase)throw Error(`Mapping scope differs for ${storyId}`);s.source_path=file.path;s.source_revision=revision;s.requirement_ids.push(requirement.id);s.criteria.push(...(refs.length?refs.map(x=>`${title} — ${x.name}\n${x.text}`):[`${title}\n${body}`]));}
  }
 }
 if(!requirements.length)throw Error('No supported OpenSpec requirements found');for(const s of stories.values())if(!s.criteria.length)throw Error(`Story ${s.id} has no mapped source criteria`);
 const previous=options.previous,prior=previous?.requirements||[];
 const delta={added:requirements.filter(r=>!prior.some(x=>x.id===r.id)).map(r=>r.id),changed:requirements.filter(r=>prior.some(x=>x.id===r.id&&(x.text!==r.text||JSON.stringify(x.stories)!==JSON.stringify(r.stories)||x.source_path!==r.source_path))).map(r=>r.id),removed:[...new Set([...prior.filter(r=>!requirements.some(x=>x.id===r.id)).map(r=>r.id),...requirements.filter(r=>r.operation==='REMOVED').map(r=>r.id)])]};
 const mapping_history=[...(previous?.mapping_history||[]),...(previous?[{revision:previous.source_revision,mappings:prior.map(r=>({id:r.id,source_path:r.source_path,stories:r.stories})),scenarios:previous.scenarios||[],tasks:previous.tasks||[]}]:[])];
 const format=options.format||{name:'standard-markdown',version:null,verified:false};
 return {source:'OpenSpec resolved standard Markdown inventory',source_revision:revision,project_id:options.project_id||null,format,requirements,stories:[...stories.values()],scenarios,tasks,warnings,delta,mapping_history};
}
