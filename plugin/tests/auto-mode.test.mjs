import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {dispatch,summary} from '../src/engine/engine.ts';
const owner={id:'owner',role:'owner'};
let seq=0;const call=(f,action,args={})=>dispatch(f.board,action,{project_id:f.p.id,event_id:'mode-'+(++seq),...args},new Date(),owner);
test('auto prepares approved queue; approval mode leaves drafts and future phases intact',()=>{
 const f=fixture();f.s.status='Draft';
 assert.throws(()=>call(f,'set_delivery_mode',{mode:'other',reason:'bad'}));
 call(f,'set_delivery_mode',{mode:'approval',reason:'manual'});assert.equal(f.s.status,'Draft');
 const out=call(f,'set_delivery_mode',{mode:'auto',reason:'user wants automatic delivery'});
 assert.equal(f.s.status,'Ready');assert.equal(f.p.workflow.delivery_mode,'auto');
 assert.ok(out.queue.ready.includes(f.s.id));
 assert.throws(()=>call(f,'update_status',{story_id:f.s.id,status:'Shipped'}));
});
test('auto preserves active attempts and holds source review, proposed work and dependencies',()=>{
 const f=fixture();f.start();const claim=f.s.claim;
 f.p.stories.push({...structuredClone(f.s),id:'WAIT',status:'Draft',claim:undefined,attempts:[],dependencies:[f.s.id]});
 f.p.stories.push({...structuredClone(f.s),id:'REVIEW',status:'Draft',claim:undefined,source_review:'changed'});
 f.p.stories.push({...structuredClone(f.s),id:'PROPOSAL',status:'Draft',claim:undefined,proposal_pending:true});
 f.p.stories.push({...structuredClone(f.s),id:'FUTURE',phase:'Future',status:'Draft',claim:undefined});
 call(f,'set_delivery_mode',{mode:'auto',reason:'auto'});
 assert.equal(f.s.status,'Verifying');assert.equal(f.s.claim,claim);
 assert.equal(f.p.stories.find(s=>s.id==='WAIT').status,'Backlog');
 for(const id of ['REVIEW','PROPOSAL','FUTURE'])assert.equal(f.p.stories.find(s=>s.id===id).status,'Draft');
});
test('reference classification is retained but not a completion requirement; cross epic mapping is valid',()=>{
 const f=fixture();f.p.requirements.push({id:'HEADER',epic:'Cross-cutting',phase:f.s.phase,stories:[],text:'Title'});
 assert.ok(summary(f.p).unmapped.includes('HEADER'));
 call(f,'classify_requirements',{reason:'metadata classification',entries:[{id:'HEADER',classification:'reference',stories:[],cross_cutting:false}]});
 assert.ok(!summary(f.p).unmapped.includes('HEADER'));assert.equal(f.p.requirements.at(-1).text,'Title');
 f.p.requirements.push({id:'GLOBAL',epic:'Cross-cutting',phase:f.s.phase,stories:[],text:'Security'});
 call(f,'classify_requirements',{reason:'same source mapping',entries:[{id:'GLOBAL',classification:'requirement',stories:[f.s.id],cross_cutting:true}]});
 assert.ok(!summary(f.p).unmapped.includes('GLOBAL'));
 assert.throws(()=>call(f,'classify_requirements',{reason:'bad mapping',entries:[{id:'GLOBAL',classification:'requirement',stories:['missing'],cross_cutting:true}]}));
});
test('closing a qualifying story unlocks dependent work automatically without a new epic approval',()=>{
 const f=fixture();f.start();call(f,'set_delivery_mode',{mode:'auto',reason:'auto'});
 assert.equal(f.p.stories[1].status,'Backlog');f.ship();assert.equal(f.p.stories[1].status,'Ready');
});
test('an unchanged legacy import preserves audited reference classification',()=>{
 const f=fixture();call(f,'set_requirements',{source:'PRD',source_revision:'1',requirements:[...f.p.requirements,{id:'HEADER',epic:'Cross-cutting',phase:'MVP',stories:[],text:'Title'}]});
 const legacy=structuredClone(f.p.requirements);
 call(f,'classify_requirements',{reason:'metadata',entries:[{id:'HEADER',classification:'reference',stories:[],cross_cutting:false}]});
 call(f,'set_requirements',{source:'PRD',source_revision:'1',requirements:legacy});
 assert.equal(f.p.requirements.find(r=>r.id==='HEADER').classification,'reference');
 assert.equal(f.p.requirements.find(r=>r.id==='HEADER').mapping_history.length,1);
});
