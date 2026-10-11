import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingHealth } from '../src/engine/tracking-health.ts';
test('missing, interrupted, dirty and outdated proof stays visible without status mutation', () => {
 const story = { id:'S1', status:'Implementing', attempt_id:'a', generation:1, revision:1, commit:'new', claim:{expires:'2020-01-01T00:00:00Z'}, runs:[{id:'r',attempt_id:'a',generation:1,criterion_revision:1,commit:'old',dirty:true}], evidence:[] };
 const before=JSON.stringify(story);
 const codes=trackingHealth({stories:[story]}).issues.map(x=>x.code);
 assert.ok(codes.includes('expired_claim')); assert.ok(codes.includes('outcome_unknown')); assert.ok(codes.includes('dirty_evidence')); assert.ok(codes.includes('outdated_evidence'));
 assert.equal(JSON.stringify(story),before);
});
test('proof from an older attempt cannot hide absent current proof', () => {
 const health=trackingHealth({stories:[{id:'S2',status:'Implementing',attempt_id:'new',generation:2,revision:2,runs:[{id:'old',attempt_id:'old',generation:1,criterion_revision:1}],evidence:[{run_id:'old',result:'pass'}]}]});
 assert.ok(health.issues.some(x=>x.code==='evidence_missing'));
 assert.ok(health.issues.some(x=>x.code==='candidate_missing'));
});
test('draft work is not falsely labeled as missing execution evidence', () => {
 assert.equal(trackingHealth({stories:[{id:'S3',status:'Draft'}]}).issues.length,0);
});
