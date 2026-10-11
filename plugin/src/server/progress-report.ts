import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {dataHome} from './store.ts';import {redactValues} from '../engine/checkpoints.ts';import type {KanbanService} from './service.ts';
const dir=()=>path.join(dataHome(),'progress-outbox');
export async function saveProgress(service:KanbanService,args:any){
 if(!args.event_id||!args.project_id)throw Error('Stable event_id and project_id required');
 const root=dir();fs.mkdirSync(root,{recursive:true,mode:0o700});
 const file=path.join(root,crypto.createHash('sha256').update(args.event_id).digest('hex')+'.json');const clean=redactValues(args);const serialized=JSON.stringify(clean);
 if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==serialized)throw Error('Pending event ID reused with different payload');
 if(!fs.existsSync(file)){const temp=file+'.'+crypto.randomUUID();fs.writeFileSync(temp,serialized,{mode:0o600});fs.renameSync(temp,file);}
 const result=await service.call('record_progress',clean);fs.unlinkSync(file);return result;
}
export async function replayProgress(service:KanbanService,projectId:string){
 const results:any[]=[];if(!fs.existsSync(dir()))return results;
 for(const name of fs.readdirSync(dir()).filter(x=>x.endsWith('.json'))){const file=path.join(dir(),name);try{const args=JSON.parse(fs.readFileSync(file,'utf8'));if(args.project_id!==projectId)continue;const result=await service.call('record_progress',args);fs.unlinkSync(file);results.push({event_id:args.event_id,delivered:true,result});}catch(error){results.push({file:name,delivered:false,error:(error as Error).message});}}
 return results;
}
