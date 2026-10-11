import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {KanbanService} from '../src/server/service.ts';
import {updateBoard} from '../src/server/update-board.ts';
test('update records real source observations without inventing proof; corrupt queue fails visibly', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cogumi-update-'));const previous=process.cwd();const oldHome=process.env.COGUMI_KANBAN_HOME;const oldOutbox=process.env.COGUMI_OUTBOX;
 const service=new KanbanService(':memory:');
 try {
  for(const args of [['init'],['config','user.name','Test'],['config','user.email','test@example.test'],['remote','add','origin','https://example.test/update'],['commit','--allow-empty','-m','init']]) assert.equal(spawnSync('git',args,{cwd:root}).status,0);
  process.chdir(root);process.env.COGUMI_KANBAN_HOME=path.join(root,'tracker');process.env.COGUMI_OUTBOX=path.join(root,'queue');
  const p=await service.call('create_project',{name:'Update',binding:'https://example.test/update',event_id:'create'});
  fs.writeFileSync(path.join(root,'work.txt'),'uncommitted');
  const report=await updateBoard(service,p.id);
  assert.equal(report.checkout.dirty,true);assert.equal(report.pending_events,0);assert.ok(fs.existsSync(report.report_path));assert.equal(fs.statSync(report.report_path).mode & 0o777,0o600);
  const b=await service.call('get_board',{project_id:p.id});assert.equal(b.reconciliations.length,1);assert.equal(b.stories.length,0);
  await service.call('set_delivery_mode',{project_id:p.id,event_id:'auto',mode:'auto',reason:'user selected auto'});
  const auto=await updateBoard(service,p.id);assert.equal(auto.delivery_mode,'auto');assert.ok(auto.queue);
  await assert.rejects(updateBoard(service,'wrong-project'),/bound repository/);
  fs.mkdirSync(process.env.COGUMI_OUTBOX);fs.writeFileSync(path.join(process.env.COGUMI_OUTBOX,'123-bad.json'),'{bad');
  await assert.rejects(updateBoard(service,p.id),SyntaxError);
 } finally {service.close();process.chdir(previous);if(oldHome===undefined)delete process.env.COGUMI_KANBAN_HOME;else process.env.COGUMI_KANBAN_HOME=oldHome;if(oldOutbox===undefined)delete process.env.COGUMI_OUTBOX;else process.env.COGUMI_OUTBOX=oldOutbox;fs.rmSync(root,{recursive:true,force:true});}
});
