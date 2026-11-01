/** Install only declared consumer roots through an npm registry, then probe each profile. */
import {openSync,closeSync,rmSync,cpSync,globSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {archiveRegistry} from './registry.mjs';
import {candidateManifest} from './consumer-manifest.mjs';
const {values}=parseArgs({options:{from:{type:'string'},product:{type:'string'},out:{type:'string'},development:{type:'boolean',default:false},'offline-registry':{type:'string'}}});
if(!values.from||!values.product||!values.out)throw new Error('Usage: verify.mjs --from RELEASE_DIRECTORY --product PRODUCT --out NEW_DIRECTORY [--development]');
const source=resolve(values.from),product=resolve(values.product),output=resolve(values.out);
if(existsSync(output))throw new Error(`Output already exists: ${output}`);mkdirSync(output,{recursive:true});
const releaseBytes=readFileSync(join(source,'release-manifest.json'));
const releaseManifestSha256=createHash('sha256').update(releaseBytes).digest('hex');
const release=JSON.parse(releaseBytes);
writeFileSync(join(output,'release-manifest.json'),releaseBytes);
if(values['offline-registry'] && !/^http:\/\/127\.0\.0\.1:\d+$/.test(values['offline-registry']))throw new Error('Offline registry must identify a cached loopback registry.');
const registry=values['offline-registry']?{url:values['offline-registry'],close:async()=>{}}:await archiveRegistry(release,join(source,'packages'));
const env={...process.env,TMPDIR:output,npm_config_cache:resolve(dirname(output),'TEMP_npm_cache'),npm_config_prefer_offline:'true',NODE_AUTH_TOKEN:'local-candidate-only',DSH_TELEMETRY_DISABLED:'1'};
if(values['offline-registry'])env.npm_config_offline='true';
const records=[];
function run(command,args,cwd,name) {
  return new Promise((done,fail)=>{
    const logPath=join(output,name+'.log'),stderrPath=join(output,name+'.stderr.log');
    const fd=openSync(logPath,'w'),err=openSync(stderrPath,'w');
    const child=spawn(command,args,{cwd,env,stdio:['ignore',fd,err]});
    let settled=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},300000);
    const finish=(code,error)=>{
      if(settled)return;settled=true;clearTimeout(timer);closeSync(fd);closeSync(err);
      records.push({name,code:timedOut?124:code,timedOut});
      if(error)fail(error);
      else if(code===0&&!timedOut)done(readFileSync(logPath,'utf8'));
      else fail(new Error(`${name} failed (${timedOut?'timeout':code}); see ${logPath} and ${stderrPath}`));
    };
    child.on('error',error=>finish(null,error));child.on('close',code=>finish(code));
  });
}
function npmrc(path){writeFileSync(join(path,'.npmrc'),`@ankdesh:registry=${registry.url}\n`);}
// Registry URLs are resolved at install time; versions and archive integrity stay locked.
function portableLock(path){const lock=JSON.parse(readFileSync(path,'utf8'));for(const value of Object.values(lock.packages||{}))if(value.resolved?.startsWith(registry.url+'/'))delete value.resolved;writeFileSync(path,JSON.stringify(lock,null,2)+'\n');}
try {
  if(values.development) {
    const directory=join(output,'development');mkdirSync(directory);
    cpSync(product,directory,{recursive:true,filter:p=>!relative(product,p).split('/').some(s=>['node_modules','lib','.dev','production'].includes(s))});
    const versions=new Map(release.packages.map(p=>[p.name,p.version]));
    for(const path of ['package.json',...globSync('bundles/*/package.json',{cwd:directory})]){
      const file=join(directory,path),manifest=candidateManifest(JSON.parse(readFileSync(file,'utf8')),versions);
      writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
    }
    const lockPath=join(directory,'package-lock.json');
    if(existsSync(lockPath)){
      const lock=JSON.parse(readFileSync(lockPath,'utf8'));
      for(const key of Object.keys(lock.packages||{}))if(key.includes('node_modules/@ankdesh/'))delete lock.packages[key];
      writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n');
    }

    npmrc(directory);
    await run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],directory,'development-install');
    await run('npm',['run','build'],directory,'development-build');
    portableLock(join(directory,'package-lock.json'));
  } else {
    const recipe=JSON.parse(readFileSync(join(product,'harness.product.json'),'utf8'));
    mkdirSync(join(output,'development'));
    for(const filename of ['package.json','package-lock.json'])cpSync(join(product,filename),join(output,'development',filename));
    for(const [name,profile]of Object.entries(recipe.profiles)) {
      const directory=join(output,name);mkdirSync(directory);
      const dependencies={'@ankdesh/dsh':release.releaseId,'@ankdesh/ankdesh-product-tools':release.releaseId};
      for(const local of profile.localBundles) {
        const bundle=resolve(product,local),manifest=JSON.parse(readFileSync(join(bundle,'package.json'),'utf8'));
        const text=await run('npm',['pack','--workspaces=false','--ignore-scripts','--json','--pack-destination',directory],bundle,name+'-pack-'+manifest.name.split('/').at(-1));
        dependencies[manifest.name]='file:'+JSON.parse(text)[0].filename;
      }
      const installManifest={name:name+'-install',private:true,type:'module',dependencies};
      writeFileSync(join(directory,'package.json'),JSON.stringify(installManifest,null,2)+'\n');
      const developmentLock=join(product,'package-lock.json');
      if(existsSync(developmentLock)){
        const lock=JSON.parse(readFileSync(developmentLock,'utf8'));lock.name=installManifest.name;
        for(const key of Object.keys(lock.packages||{}))if(!key.startsWith('node_modules/')||lock.packages[key].link)delete lock.packages[key];
        lock.packages['']=installManifest;
        writeFileSync(join(directory,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
      }
      npmrc(directory);
      await run('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],directory,name+'-install');
      cpSync(join(source,'release-manifest.json'),join(directory,'release-manifest.json'));
      const probe=`
        import {prepareProductProfile,packageDirectory,installedGraph} from '@ankdesh/ankdesh-product-tools';
        import {measureInstallation} from ${JSON.stringify(pathToFileURL(join(import.meta.dirname,'measure.mjs')).href)};
        import {resolve} from 'node:path';import{writeFileSync}from'node:fs';
        const bundles=${JSON.stringify(profile.bundles)};
        prepareProductProfile(process.cwd(),resolve('.state'),{profileName:${JSON.stringify(name)},bundles,localBundles:bundles.map(n=>packageDirectory(n,process.cwd())),patchReload:'startup'});
        const graph=installedGraph(Object.keys(${JSON.stringify(dependencies)}),process.cwd());
        const measurement=measureInstallation(process.cwd(),${JSON.stringify(env.npm_config_cache)});
        const names=measurement.packages.map(n=>n.name);
        if(${JSON.stringify(name)}.endsWith('headless')&&names.some(n=>/dsh-client|dsh-web-frontend|ankdesh-web-runtime/.test(n)))throw new Error('Headless install has browser packages');
        const cordis=[...graph.values()].filter(n=>n.manifest.name==='@ankdesh/cordis');if(cordis.length!==1)throw new Error('Expected one Cordis instance');
        writeFileSync('installed-packages.json',JSON.stringify([...graph.values()].map(n=>({name:n.manifest.name,version:n.manifest.version})),null,2));
        writeFileSync('measurements.json',JSON.stringify(measurement,null,2));
      `;
      writeFileSync(join(directory,'probe.mjs'),probe);await run(process.execPath,['probe.mjs'],directory,name+'-graph');
      env.DSH_HOME=join(directory,'.state');
      await run(process.execPath,[join(directory,'node_modules/@ankdesh/dsh/lib/bin.js'),'--profile',name,'--dump-config'],directory,name+'-config');
      await run(process.execPath,[join(directory,'node_modules/@ankdesh/dsh/lib/bin.js'),'--profile',name,'--help'],directory,name+'-help');
      // Export a registry-only production lock. Application bundles are copied from the application's own build.
      const productionManifest={name:name+'-install',private:true,type:'module',dependencies:release.profiles[name].roots};
      writeFileSync(join(directory,'package.json'),JSON.stringify(productionManifest,null,2)+'\n');
      await run('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],directory,name+'-lock');
      portableLock(join(directory,'package-lock.json'));
      // Re-run the actual locked install, including platform-specific optional payloads.
      await run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],directory,name+'-ci');
      // Copy only built application files; no source dependency installation is performed here.
      for(const local of profile.localBundles) {
        const bundle=resolve(product,local),manifest=JSON.parse(readFileSync(join(bundle,'package.json'),'utf8'));
        const destination=join(directory,'node_modules',manifest.name);mkdirSync(destination,{recursive:true});
        for(const pattern of manifest.files||[])for(const file of globSync(pattern,{cwd:bundle}))cpSync(join(bundle,file),join(destination,file),{recursive:true});
        cpSync(join(bundle,'package.json'),join(destination,'package.json'));
      }
      await run(process.execPath,['probe.mjs'],directory,name+'-locked-graph');
      await run(process.execPath,[join(directory,'node_modules/@ankdesh/dsh/lib/bin.js'),'--profile',name,'--dump-config'],directory,name+'-locked-config');
      const assembly=`
        import {assembleProduct} from '@ankdesh/ankdesh-product-tools';
        import {cpSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
        const output=resolve('assembled');
        assembleProduct({from:process.cwd(),output,roots:${JSON.stringify(['@ankdesh/dsh','@ankdesh/ankdesh-product-tools',...profile.bundles])},releaseManifest:resolve('release-manifest.json'),releaseManifestSha256:${JSON.stringify(releaseManifestSha256)}});
        cpSync(${JSON.stringify(join(product,'deployment'))},resolve(output,'deployment'),{recursive:true});
        writeFileSync(resolve(output,'harness.product.json'),JSON.stringify({defaultProfile:${JSON.stringify(name)},profiles:{[${JSON.stringify(name)}]:${JSON.stringify(profile)}}}));
      `;
      writeFileSync(join(directory,'assembly.mjs'),assembly);
      await run(process.execPath,['assembly.mjs'],directory,name+'-assembly');
      env.ASSISTANT_STATE=join(directory,'.assembly-state');
      env.ASSISTANT_PROFILE=name;
      await run(process.execPath,[join(directory,'assembled/deployment/launch.mjs'),'--dump-config'],directory,name+'-assembled-config');
      if(release.profiles[name].packages.includes('@ankdesh/ankdesh-web-runtime'))await run(process.execPath,[join(import.meta.dirname,'web-smoke.mjs'),join(directory,'assembled')],directory,name+'-web-start');
      delete env.ASSISTANT_STATE;delete env.ASSISTANT_PROFILE;
    }
  }
} finally {
  await registry.close();const productionLocks={},developmentLock={};
  if(!values.development)for(const filename of ['package.json','package-lock.json']){
    const path=join(output,'development',filename);
    if(existsSync(path))developmentLock[filename]=createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  if(!values.development)for(const name of Object.keys(release.profiles)){
    productionLocks[name]={};
    for(const filename of ['package.json','package-lock.json','measurements.json']){
      const path=join(output,name,filename);
      if(existsSync(path))productionLocks[name][filename]=createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  writeFileSync(join(output,'verification.json'),JSON.stringify({releaseId:release.releaseId,releaseManifestSha256,registryMode:values['offline-registry']?'offline-cache':'live-candidate',developmentLock,productionLocks,records},null,2)+'\n');
}
