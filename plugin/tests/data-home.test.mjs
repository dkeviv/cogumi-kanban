import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('renamed plugin preserves legacy data and uses new home for fresh installs', () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cogumi-rename-'));
 const env={...process.env,HOME:home}; delete env.COGUMI_KANBAN_HOME;
 const resolve=()=>{const r=spawnSync(process.execPath,['--input-type=module','-e',"import {dataHome} from './dist/lib.mjs';console.log(dataHome())"],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
 try {
  assert.equal(resolve(),path.join(home,'.cogumi-kanban'));
  const legacy=path.join(home,'.cogumi-claude-kanban');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'kanban.db'),'existing');
  assert.equal(resolve(),legacy);
  fs.mkdirSync(path.join(home,'.cogumi-kanban'));assert.equal(resolve(),legacy);
  env.COGUMI_KANBAN_HOME=path.join(home,'override');assert.equal(resolve(),env.COGUMI_KANBAN_HOME);
  assert.equal(fs.readFileSync(path.join(legacy,'kanban.db'),'utf8'),'existing');
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
