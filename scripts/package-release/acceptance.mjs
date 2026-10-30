/** Run the consumer acceptance profiles against the verified candidate installation. */
import {cpSync,existsSync,lstatSync,mkdirSync,openSync,closeSync,readFileSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {candidateManifest} from './consumer-manifest.mjs';
const {values}=parseArgs({options:{consumer:{type:'string'},development:{type:'string'},verification:{type:'string'}}});
if(!values.consumer||!values.development||!values.verification)throw new Error('Usage: acceptance.mjs --consumer SPEC2GDS_ROOT --development VERIFIED_DEVELOPMENT_DIRECTORY --verification VERIFIED_PROFILE_DIRECTORY');
const consumer=resolve(values.consumer),development=resolve(values.development),verification=resolve(values.verification);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const evidencePath=join(verification,'verification.json'),evidence=read(evidencePath);
const developmentEvidence=read(join(development,'verification.json'));
if(evidence.registryMode!=='live-candidate'||developmentEvidence.registryMode!=='live-candidate'||developmentEvidence.releaseManifestSha256!==evidence.releaseManifestSha256||!developmentEvidence.records.some(r=>r.name==='development-build'&&r.code===0)||developmentEvidence.records.some(r=>r.code!==0))throw new Error('Development build and production profiles must use the same verified candidate archives.');
const application=join(consumer,'ai-assistant'),built=join(development,'development');
for(const filename of ['package.json','package-lock.json'])if(createHash('sha256').update(readFileSync(join(built,filename))).digest('hex')!==evidence.developmentLock?.[filename])throw new Error('Production verification uses a different development lock or manifest.');
const candidate=read(join(development,'release-manifest.json'));
const versions=new Map(candidate.packages.map(p=>[p.name,p.version]));
for(const path of ['package.json','bundles/web/package.json','bundles/headless/package.json','bundles/replay/package.json']){
 const manifest=candidateManifest(read(join(application,path)),versions);
 if(JSON.stringify(manifest)!==JSON.stringify(read(join(built,path))))throw new Error(`Consumer package differs from the verified development build: ${path}`);
}
const target=realpathSync(join(built,'node_modules')),modules=join(application,'node_modules');
if(existsSync(modules)||(()=>{try{return lstatSync(modules).isSymbolicLink();}catch(error){if(error.code==='ENOENT')return false;throw error;}})()){
 if(realpathSync(modules)!==target)throw new Error('Consumer node_modules must use the verified development installation. Use a clean consumer checkout.');
}else symlinkSync(target,modules,'dir');
const consumerCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:consumer,encoding:'utf8'}).trim();
const sourceDirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:consumer,encoding:'utf8'}).trim());
const output=join(consumer,'TEMP_package_acceptance');if(existsSync(output))throw new Error(`Acceptance output already exists: ${output}`);mkdirSync(output,{recursive:true});
const env={...process.env,TMPDIR:output,npm_config_cache:join(output,'TEMP_npm_cache')};
let failed=false;
for(const profile of ['fast','integration','regression']){
 const destination=join(output,profile),args=['scripts/test-all.sh',profile,...(profile==='integration'?['--scope','assistant,shared']:[]),'--output',destination];
 const fd=openSync(join(output,profile+'.log'),'w');
 let code;
 try{code=await new Promise((done,fail)=>{const child=spawn('bash',args,{cwd:consumer,env,stdio:['ignore',fd,fd]});child.on('error',fail);child.on('close',done);});}finally{closeSync(fd);}
 const summaryPath=join(destination,'summary.json');
 const summary=existsSync(summaryPath)?read(summaryPath):undefined;
 const success=code===0&&summary?.status==='passed'&&!summary.incomplete;
 const name='application-'+profile;evidence.records=evidence.records.filter(r=>r.name!==name);
 evidence.records.push({name,code:success?0:(code||1),consumerCommit,sourceDirty,reportSha256:existsSync(summaryPath)?createHash('sha256').update(readFileSync(summaryPath)).digest('hex'):null});
 if(existsSync(destination))cpSync(destination,join(verification,name),{recursive:true});
 writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
 console.log(`${name}: ${success?'passed':'failed or incomplete'}`);if(!success)failed=true;
}
if(failed)process.exitCode=1;
