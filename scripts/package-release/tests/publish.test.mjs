/** Publication validation must reject incomplete evidence before any registry write. */
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import{join,resolve,delimiter}from'node:path';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';
const parent=resolve(import.meta.dirname,'../../../TEMP_release_tests');mkdirSync(parent,{recursive:true});
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
function fixture(t){
 const root=mkdtempSync(join(parent,'publish-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'packages'));
 const archive=Buffer.from('candidate archive');writeFileSync(join(root,'packages/pkg.tgz'),archive);
 const roots={'@ankdesh/pkg':'1.0.0'};
 const manifest={releaseId:'test',sourceCommit:'source',consumerCommit:'consumer',sourceDirty:false,consumerDirty:false,packages:[{name:'@ankdesh/pkg',version:'1.0.0',dependencies:{},file:'pkg.tgz',sha256:digest(archive),integrity:'sha512-'+digest(archive,'sha512')}],profiles:{test:{roots}}};
 writeFileSync(join(root,'release-manifest.json'),JSON.stringify(manifest));
 mkdirSync(join(root,'test'));writeFileSync(join(root,'test/package.json'),JSON.stringify({dependencies:roots}));writeFileSync(join(root,'test/package-lock.json'),JSON.stringify({packages:{'':{dependencies:roots}}}));
 mkdirSync(join(root,'development'));for(const filename of ['package.json','package-lock.json'])writeFileSync(join(root,'development',filename),readFileSync(join(root,'test',filename)));
 const report=JSON.stringify({status:'passed',incomplete:false});
 for(const stage of ['fast','integration','regression']){mkdirSync(join(root,'application-'+stage));writeFileSync(join(root,'application-'+stage,'summary.json'),report);}
 const records=[...['install','graph','config','help','lock','ci','locked-graph','locked-config','assembly','assembled-config'].map(stage=>({name:'test-'+stage,code:0})),...['fast','integration','regression'].map(stage=>({name:'application-'+stage,code:0,consumerCommit:'consumer',sourceDirty:false,reportSha256:digest(report)}))];
 const productionLocks={test:Object.fromEntries(['package.json','package-lock.json'].map(filename=>[filename,digest(readFileSync(join(root,'test',filename)))]))};
 const developmentLock=Object.fromEntries(['package.json','package-lock.json'].map(filename=>[filename,digest(readFileSync(join(root,'development',filename)))]));
 const evidence={releaseId:'test',releaseManifestSha256:digest(readFileSync(join(root,'release-manifest.json'))),registryMode:'live-candidate',developmentLock,productionLocks,records};
 const save=()=>writeFileSync(join(root,'verification.json'),JSON.stringify(evidence));save();
 const run=(args=['--dry-run'],env={})=>spawnSync(process.execPath,[resolve(import.meta.dirname,'../publish.mjs'),'--from',root,'--verification',root,...args],{encoding:'utf8',env:{...process.env,...env}});
 return{root,evidence,save,run};
}
test('complete evidence validates the archive without a registry token or write',t=>{const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/publication is disabled/);});
test('a changed archive cannot pass publication validation',t=>{const f=fixture(t);writeFileSync(join(f.root,'packages/pkg.tgz'),'different');const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Archive checksum differs/);});
test('missing consumer acceptance prevents publication',t=>{const f=fixture(t);f.evidence.records=f.evidence.records.filter(r=>r.name!=='application-regression');f.save();const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Missing consumer acceptance evidence/);});
test('a missing assembled-release check prevents publication',t=>{const f=fixture(t);f.evidence.records=f.evidence.records.filter(r=>r.name!=='test-assembled-config');f.save();const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Missing verification: test-assembled-config/);});
test('a production lock cannot change after consumer verification',t=>{const f=fixture(t);writeFileSync(join(f.root,'test/package-lock.json'),readFileSync(join(f.root,'test/package-lock.json'),'utf8')+'\n');const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/no longer matches its tested checksum/);});
test('publishing supplies an explicit prerelease tag and creates a receipt after registry verification',t=>{
 const f=fixture(t),bin=join(f.root,'bin');mkdirSync(bin);
 writeFileSync(join(f.root,'package.json'),JSON.stringify({type:'commonjs'}));
 writeFileSync(join(bin,'npm'),`#!/usr/bin/env node
 const fs=require('fs'),path=require('path');const root=${JSON.stringify(f.root)},args=process.argv.slice(2);
 fs.appendFileSync(path.join(root,'commands.jsonl'),JSON.stringify(args)+'\\n');
 const state=path.join(root,'published');
 if(args[0]==='view'){
  if(!fs.existsSync(state)){console.error('E404');process.exit(1);}
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));console.log(JSON.stringify(manifest.packages[0].integrity));process.exit(0);
 }
 if(args[0]==='publish'&&args.includes('--tag')&&args[args.indexOf('--tag')+1]==='candidate'){fs.writeFileSync(state,'yes');process.exit(0);}
 console.error('Explicit prerelease tag is required');process.exit(1);
 `,{mode:0o755});
 const result=f.run([],{PATH:bin+delimiter+process.env.PATH,NODE_AUTH_TOKEN:'test-only'});assert.equal(result.status,0,result.stderr);
 const receipt=JSON.parse(readFileSync(join(f.root,'promotion.json'),'utf8'));assert.equal(receipt.releaseId,'test');assert.equal(receipt.productionLocks.test['package-lock.json'],digest(readFileSync(join(f.root,'consumer-verification/test/package-lock.json'))));
 const commands=readFileSync(join(f.root,'commands.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(commands.map(args=>args[0]),['view','publish','view']);
});
