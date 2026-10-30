/** Publish only verified archive bytes. Promotion follows complete registry verification. */
import {createHash} from 'node:crypto';
import {openSync,closeSync,readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{from:{type:'string'},verification:{type:'string'},'dry-run':{type:'boolean',default:false}}});
if(!values.from||!values.verification)throw new Error('Usage: publish.mjs --from RELEASE_DIRECTORY --verification VERIFIED_DIRECTORY [--dry-run]');
const directory=resolve(values.from),manifest=JSON.parse(readFileSync(join(directory,'release-manifest.json'),'utf8'));
const hash=(bytes,algo='sha256')=>createHash(algo).update(bytes).digest(algo==='sha512'?'base64':'hex');
if(manifest.measurementOnly)throw new Error('A measurement-only baseline cannot be published.');
if(manifest.sourceDirty)throw new Error('A local dirty candidate cannot be published.');
if(manifest.consumerDirty||!manifest.consumerCommit)throw new Error('Publication requires a recorded clean consumer commit.');
const verificationDirectory=resolve(values.verification);
const evidenceBytes=readFileSync(join(verificationDirectory,'verification.json'));
const evidence=JSON.parse(evidenceBytes);
if(evidence.registryMode!=='live-candidate')throw new Error('Publication requires live candidate registry verification.');
if(evidence.releaseManifestSha256!==hash(readFileSync(join(directory,'release-manifest.json')))||evidence.releaseId!==manifest.releaseId||!evidence.records.length||evidence.records.some(r=>r.code!==0))throw new Error('Consumer verification is incomplete or failed.');
for(const profile of Object.keys(manifest.profiles))for(const stage of ['install','graph','config','help','lock','ci','locked-graph','locked-config','assembly','assembled-config'])if(!evidence.records.some(r=>r.name===profile+'-'+stage&&r.code===0))throw new Error(`Missing verification: ${profile}-${stage}`);
for(const [profile,definition]of Object.entries(manifest.profiles))if(definition.packages?.includes('@ankdesh/dsh-web-runtime')&&!evidence.records.some(r=>r.name===profile+'-web-start'&&r.code===0))throw new Error(`Missing verification: ${profile}-web-start`);
// Publication requires installation, assembly, and application acceptance evidence.
for(const stage of ['application-fast','application-integration','application-regression'])if(!evidence.records.some(r=>r.name===stage&&r.code===0&&!r.sourceDirty&&r.consumerCommit===manifest.consumerCommit))throw new Error(`Missing consumer acceptance evidence: ${stage}`);
for(const p of manifest.packages) {
 const bytes=readFileSync(join(directory,'packages',p.file));
 if(hash(bytes)!==p.sha256||'sha512-'+hash(bytes,'sha512')!==p.integrity)throw new Error(`Archive checksum differs: ${p.name}`);
}
const productionLocks={},consumerFiles=[];
const developmentLock={};
for(const filename of ['package.json','package-lock.json']){
 const bytes=readFileSync(join(verificationDirectory,'development',filename));
 if(evidence.developmentLock?.[filename]!==hash(bytes))throw new Error('Verified development lock no longer matches its tested checksum.');
 developmentLock[filename]=hash(bytes);consumerFiles.push({profile:'development',filename,bytes});
}
const testReports={};
for(const stage of ['application-fast','application-integration','application-regression']){
 const record=evidence.records.find(r=>r.name===stage);
 const bytes=readFileSync(join(verificationDirectory,stage,'summary.json'));
 const summary=JSON.parse(bytes);
 if(record.reportSha256!==hash(bytes)||summary.status!=='passed'||summary.incomplete)throw new Error(`Consumer acceptance report differs or is incomplete: ${stage}`);
 testReports[stage]=hash(bytes);consumerFiles.push({profile:stage,filename:'summary.json',bytes});
}
for(const [profile,definition]of Object.entries(manifest.profiles)){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile))throw new Error('Invalid release profile name.');
 productionLocks[profile]={};
 for(const filename of ['package.json','package-lock.json',...(existsSync(join(verificationDirectory,profile,'measurements.json'))?['measurements.json']:[])]){
  const bytes=readFileSync(join(verificationDirectory,profile,filename));
  if(evidence.productionLocks?.[profile]?.[filename]!==hash(bytes))throw new Error(`Verified production file no longer matches its tested checksum: ${profile}/${filename}`);
  const parsed=JSON.parse(bytes);
  if(filename!=='measurements.json'){
   const dependencies=filename==='package.json'?parsed.dependencies:parsed.packages?.['']?.dependencies;
   if(JSON.stringify(Object.entries(dependencies||{}).sort())!==JSON.stringify(Object.entries(definition.roots||{}).sort()))throw new Error(`Verified production roots differ for ${profile}/${filename}`);
  }
  productionLocks[profile][filename]=hash(bytes);consumerFiles.push({profile,filename,bytes});
 }
}
if(values['dry-run']){console.log(`Verified ${manifest.packages.length} archives; publication is disabled.`);process.exit(0);}
if(!process.env.NODE_AUTH_TOKEN)throw new Error('NODE_AUTH_TOKEN with package write permission is required.');
async function npm(args) {
 const temp=mkdtempSync(join(directory,'TEMP_publish-')),stdout=join(temp,'stdout'),stderr=join(temp,'stderr');
 const out=openSync(stdout,'w'),err=openSync(stderr,'w');
 try {
  const code=await new Promise((done,fail)=>{const child=spawn('npm',[...args,'--registry=https://npm.pkg.github.com','--cache',join(directory,'TEMP_npm_cache')],{env:process.env,stdio:['ignore',out,err]});child.on('error',fail);child.on('close',done);});
  return {code,stdout:readFileSync(stdout,'utf8'),stderr:readFileSync(stderr,'utf8')};
 }finally{closeSync(out);closeSync(err);rmSync(temp,{recursive:true,force:true});}
}
// Required install dependencies precede consumers. Peer cycles do not constrain archive publication.
const pending=new Map(manifest.packages.map(p=>[p.name,p])),order=[];
while(pending.size){const next=[...pending.values()].find(p=>Object.keys(p.dependencies).every(n=>!pending.has(n)));if(!next)throw new Error('Required install dependencies form a cycle.');pending.delete(next.name);order.push(next);}
for(const p of order) {
 const before=await npm(['view',`${p.name}@${p.version}`,'dist.integrity','--json']);
 if(before.code===0){if(JSON.parse(before.stdout)!==p.integrity)throw new Error(`Registry version conflicts: ${p.name}`);}
 else {
  if(!/E404|404 Not Found/.test(before.stderr))throw new Error(`Registry access failed for ${p.name}: ${before.stderr}`);
  // npm requires an explicit tag for prerelease versions. Promotion uses the release receipt.
  const result=await npm(['publish',join(directory,'packages',p.file),'--ignore-scripts','--tag','candidate']);if(result.code!==0)throw new Error(`Publication failed for ${p.name}: ${result.stderr}`);
 }
 const after=await npm(['view',`${p.name}@${p.version}`,'dist.integrity','--json']);
 if(after.code!==0||JSON.parse(after.stdout)!==p.integrity)throw new Error(`Published bytes do not match: ${p.name}`);
 console.log(`Verified ${p.name}@${p.version}`);
}
const consumerDirectory=join(directory,'consumer-verification');mkdirSync(consumerDirectory,{recursive:true});
writeFileSync(join(consumerDirectory,'verification.json'),evidenceBytes);
for(const {profile,filename,bytes}of consumerFiles){mkdirSync(join(consumerDirectory,profile),{recursive:true});writeFileSync(join(consumerDirectory,profile,filename),bytes);}
writeFileSync(join(directory,'promotion.json'),JSON.stringify({releaseId:manifest.releaseId,sourceCommit:manifest.sourceCommit,releaseManifestSha256:hash(readFileSync(join(directory,'release-manifest.json'))),verificationSha256:hash(evidenceBytes),developmentLock,productionLocks,testReports,testResults:evidence.records},null,2)+'\n');
