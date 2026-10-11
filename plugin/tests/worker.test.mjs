import test from 'node:test';
import assert from 'node:assert/strict';
import {workerArgs,workerFingerprint} from '../src/server/worker.ts';
import {dispatch} from '../src/engine/engine.ts';
test('Auto is default and legacy explicit Approval is preserved',()=>{
 const board={projects:[]};const owner={id:'test',role:'owner'};
 const p=dispatch(board,'create_project',{event_id:'create',name:'Test',binding:'repo:test'},new Date(),owner);
 assert.equal(p.workflow.delivery_mode,'auto');delete p.workflow.delivery_mode;
 dispatch(board,'get_board',{project_id:p.id},new Date(),owner);assert.equal(p.workflow.delivery_mode,'auto');
 p.workflow.delivery_mode='approval';dispatch(board,'configure_workflow',{project_id:p.id,event_id:'strict',strict_checks:true,reason:'strict proof'},new Date(),owner);assert.equal(p.workflow.delivery_mode,'approval');dispatch(board,'get_board',{project_id:p.id},new Date(),owner);assert.equal(p.workflow.delivery_mode,'approval');
});
test('worker resumes exact host sessions without disabling sandbox or permissions',()=>{
 assert.deepEqual(workerArgs('codex','session').slice(-2),['session','-']);
 assert.ok(workerArgs('codex').includes('workspace-write'));
 assert.ok(workerArgs('claude','session').includes('--resume'));
 assert.ok(!workerArgs('claude').includes('--dangerously-skip-permissions'));
 assert.throws(()=>workerArgs('unknown'));
});
test('worker notices proof progress and mode changes but ignores reconciliation noise',()=>{
 const b={workflow:{delivery_mode:'auto'},stories:[{id:'s',status:'Backlog',runs:[]}]};const first=workerFingerprint(b);
 b.reconciliations=[{}];assert.equal(workerFingerprint(b),first);
 b.stories[0].runs.push({});assert.notEqual(workerFingerprint(b),first);
 const next=workerFingerprint(b);b.workflow.delivery_mode='approval';assert.notEqual(workerFingerprint(b),next);
});
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {KanbanService} from '../src/server/service.ts';
test('real supervisor saves its host session and stops cleanly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cogumi-worker-'));const home=path.join(root,'data');const old=process.env.COGUMI_KANBAN_HOME;process.env.COGUMI_KANBAN_HOME=home;const service=new KanbanService();let child;
 try{
  for(const args of [['init'],['config','user.name','Test'],['config','user.email','test@example.test'],['commit','--allow-empty','-m','init']])assert.equal(spawnSync('git',args,{cwd:root}).status,0);
  const binding='local:'+spawnSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).stdout.trim();
  const p=await service.call('create_project',{event_id:'create',name:'Worker',binding});
  await service.call('import_stories',{project_id:p.id,event_id:'import',source:'test',source_revision:'1',stories:[{id:'S',epic:'E',title:'Work',criteria:['works']}]});
  const dir=path.join(home,'workers',p.id);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'state.json');
  const fake=path.join(root,'fake-host');fs.writeFileSync(fake,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'thread.started',thread_id:'saved-session'})));\n`,{mode:0o700});
  fs.writeFileSync(file,JSON.stringify({enabled:true,host:'codex',executable:fake}));
  child=spawn(process.execPath,[new URL('../dist/cli.mjs',import.meta.url).pathname,'worker','run'],{cwd:root,env:{...process.env,COGUMI_KANBAN_HOME:home},stdio:'ignore'});
  let state;const until=Date.now()+10000;while(Date.now()<until){state=JSON.parse(fs.readFileSync(file));if(state.session&&state.child_pid===null)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(state.session,'saved-session');assert.equal(state.last_exit,0);assert.ok(state.retry_at>Date.now());
  child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
  state.retry_at=0;fs.writeFileSync(file,JSON.stringify(state));
  child=spawn(process.execPath,[new URL('../dist/cli.mjs',import.meta.url).pathname,'worker','run'],{cwd:root,env:{...process.env,COGUMI_KANBAN_HOME:home},stdio:'ignore'});
  const restartUntil=Date.now()+10000;while(Date.now()<restartUntil){state=JSON.parse(fs.readFileSync(file));if(state.pid===child.pid&&state.child_pid===null&&state.retry_at>Date.now())break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(state.pid,child.pid);assert.equal(state.session,'saved-session');assert.equal(fs.readFileSync(path.join(dir,'worker.jsonl'),'utf8').trim().split('\n').length,2);
  fs.writeFileSync(file,JSON.stringify({...state,enabled:false}));const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,0);assert.equal(JSON.parse(fs.readFileSync(file)).enabled,false);assert.equal(fs.existsSync(path.join(dir,'supervisor.lock')),false);
 }finally{child?.kill();service.close();if(old===undefined)delete process.env.COGUMI_KANBAN_HOME;else process.env.COGUMI_KANBAN_HOME=old;fs.rmSync(root,{recursive:true,force:true});}
});
