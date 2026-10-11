import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,A} from './helpers.mjs';import {dispatch,eligibility} from '../src/engine/engine.ts';import {deliveryControl} from '../src/engine/delivery-control.ts';import {trackingHealth} from '../src/engine/tracking-health.ts';
const plan=[{type:'api',expected:'saved',evidence_requirement:'real response',checks:[{id:'f',kind:'functional',command:'node checks.mjs',assertions:['saved']},{id:'d',kind:'deployed',command:'node deployed.mjs',assertions:['saved on release']}]},{type:'integration',expected:'isolated',evidence_requirement:'isolation',checks:[{id:'f2',kind:'functional',command:'node checks.mjs',assertions:['isolated']},{id:'d2',kind:'deployed',command:'node deployed.mjs',assertions:['isolated on release']}]}];
test('plans are revision gated, preserve criteria, promote Auto and leave Approval in Backlog',()=>{
 for(const mode of ['auto','approval']){const f=fixture();f.s.status='Backlog';f.s.proof_plan=[];f.p.workflow.delivery_mode=mode;const criteria=structuredClone(f.s.criteria);
 assert.equal(deliveryControl(f.p,eligibility).tasks[0].kind,'prepare_verification');
 assert.throws(()=>f.go('prepare_verification',{criterion_revision:99,proof_plan:plan,reason:'assessment'}),/Criteria changed/);
 assert.throws(()=>f.go('prepare_verification',{criterion_revision:f.s.revision,proof_plan:[],reason:'assessment'}));
 f.go('prepare_verification',{criterion_revision:f.s.revision,proof_plan:plan,reason:'reviewed actual checks'});assert.deepEqual(f.s.criteria,criteria);assert.equal(f.s.status,mode==='auto'?'Ready':'Backlog');
 }
});
test('work limit retains old claims, rejects another claim from same worker and permits another worker',()=>{
 const f=fixture();f.start();const s=structuredClone(f.s);Object.assign(s,{id:'OTHER',status:'Ready',claim:undefined,attempts:[],dependencies:[]});f.p.stories.push(s);
 assert.throws(()=>f.go('claim_story',{story_id:'OTHER',worker:'worker',branch:'other',starting_commit:A,plan:'checks'}),/Work-in-progress/);
 assert.throws(()=>f.go('prepare_verification',{criterion_revision:f.s.revision,proof_plan:plan,reason:'plan'}),/existing attempt/);
 f.go('claim_story',{story_id:'OTHER',worker:'other-worker',branch:'other',starting_commit:A,plan:'checks'});assert.equal(s.status,'Implementing');assert.ok(f.s.claim);
});
test('corrective tasks distinguish candidate, unfinished run, functional and release verification',()=>{
 const f=fixture();f.start();f.s.commit=undefined;assert.equal(deliveryControl(f.p,eligibility).tasks[0].kind,'record_candidate');f.s.commit=A;
 assert.equal(deliveryControl(f.p,eligibility).tasks[0].kind,'verify_functional');const r=f.begin();assert.equal(deliveryControl(f.p,eligibility).tasks[0].kind,'recover_run');f.evidence(r);assert.equal(deliveryControl(f.p,eligibility).tasks[0].kind,'verify_release');
 const wait=deliveryControl(f.p,eligibility,Date.now(),'another');assert.equal(wait.tasks[0].waiting_on_worker,true);
});
test('heartbeats cannot hide stalled work; reconciliation persists tasks without resetting progress',()=>{
 const f=fixture();f.start();const at=new Date(Date.now()-31*60000).toISOString();f.s.last_progress_at=at;f.s.history.push({action:'renew_claim',at:new Date().toISOString()});
 assert.ok(trackingHealth(f.p).issues.some(x=>x.code==='stalled_progress'));f.go('reconcile',{commit:A,pending_events:0});assert.equal(f.s.last_progress_at,at);assert.ok(f.p.delivery_control.tasks[0].stalled);
 f.ev();assert.ok(!trackingHealth(f.p).issues.some(x=>x.code==='stalled_progress'));
});
