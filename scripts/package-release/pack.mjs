/** Build a selected npm release from built workspace artifacts. Never edits workspace manifests. */
import {createHash} from 'node:crypto';
import {openSync, closeSync, mkdtempSync, rmSync, cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync} from 'node:fs';
import {dirname, join, resolve, relative} from 'node:path';
import {builtinModules} from 'node:module';
import {spawn} from 'node:child_process';
import {productRoots} from './consumer-manifest.mjs';
async function capture(command,args,options={}) {
  const temporary=mkdtempSync(join(dirname(output),'TEMP_package_release-'));
  const stdout=join(temporary,'stdout'),stderr=join(temporary,'stderr');
  const out=openSync(stdout,'w'),err=openSync(stderr,'w');
  try {
    await new Promise((done,fail)=>{
      const child=spawn(command,args,{...options,stdio:['ignore',out,err]});
      child.on('error',fail);child.on('close',code=>code===0?done():fail(new Error(`${command} exited ${code}: ${readFileSync(stderr,'utf8')}`)));
    });
    return readFileSync(stdout,'utf8');
  } finally {closeSync(out);closeSync(err);rmSync(temporary,{recursive:true,force:true});}
}
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
let root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = (bytes, algorithm='sha256') => createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
const rescope = text => text.replaceAll('@deepseek-ai/', '@ankdesh/');
const sourceName = name => name.replace('@ankdesh/', '@deepseek-ai/');
const packageName = name => name.startsWith('@') ? name.split('/').slice(0,2).join('/') : name.split('/')[0];
const {values} = parseArgs({options:{product:{type:'string'},out:{type:'string'},suffix:{type:'string',default:'ankdesh.1'},source:{type:'string'},'stock-cli':{type:'boolean',default:false},'allow-dirty':{type:'boolean',default:false}}});
if (!values.product || !values.out || !/^ankdesh\.\d+$/.test(values.suffix)) throw new Error('Usage: pack.mjs --product PRODUCT --out NEW_DIRECTORY [--suffix ankdesh.N]');
const product = resolve(values.product), output = resolve(values.out);
if(values.source)root=resolve(values.source);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const dirty = (await capture('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})).trim();
if (dirty && !values['allow-dirty']) throw new Error('Release packing requires a clean checkout. --allow-dirty is only for local candidate checks.');
const index = new Map();
for (const pattern of ['packages/*/*/package.json','tools/*/package.json','vendor/*/package.json','apps/cli/package.json','apps/web/package.json','native/system/packages/*/package.json']) {
  for (const file of globSync(pattern,{cwd:root})) {const directory=dirname(join(root,file));const manifest=json(join(root,file));index.set(manifest.name,{directory,manifest});}
}
const versions = new Map([...index].map(([name,{manifest}])=>[name, `${manifest.version.split('-')[0]}-${values.suffix}`]));
const selected = new Map(), reasons = new Map();
function importedPackages(directory) {
  const names = new Set();
  for (const file of globSync('lib/*.js',{cwd:directory})) {
    const text=readFileSync(join(directory,file),'utf8');
    // Built CLI chunks contain static imports and literal dynamic imports. Dynamic profile names are supplied by the product manifest.
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec=match[1];if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:') && !builtinModules.includes(spec)) names.add(packageName(spec));
    }
  }
  return names;
}
function add(name, reason) {
  name=sourceName(packageName(name));if (!index.has(name)) return;
  if (!reasons.has(name)) reasons.set(name,new Set());reasons.get(name).add(reason);
  if (selected.has(name)) return;
  const source=index.get(name);const manifest=structuredClone(source.manifest);
  if (name==='@deepseek-ai/dsh' && !values['stock-cli']) {
    manifest.dependencies=Object.fromEntries([...importedPackages(source.directory)].map(n=>[n,source.manifest.dependencies?.[n] || 'workspace:^']));
    delete manifest.dsh;
  }
  selected.set(name,{...source,manifest});
  for (const section of ['dependencies','peerDependencies','optionalDependencies']) for (const child of Object.keys(manifest[section]||{})) {
    const target=index.get(child)?.manifest;
    // This first distribution supports Linux x64. Publish only matching optional platform payloads.
    if (section==='optionalDependencies' && target && ((target.os && !target.os.includes('linux')) || (target.cpu && !target.cpu.includes('x64')))) {delete manifest[section][child];continue;}
    add(child,`${rescope(name)}: ${section}`);
  }
  for (const child of manifest.dsh?.client?.inject||[]) add(child, `${rescope(name)}: browser injection`);
}
const recipe=json(join(product,'harness.product.json'));
const profileRoots={},profileDependencies={};
for (const [name,profile] of Object.entries(recipe.profiles)) {
  const manifests=profile.localBundles.map(local=>json(join(product,local,'package.json')));
  const dependencies=productRoots(manifests,new Map([...versions].map(([n,v])=>[rescope(n),v])));
  const roots=Object.keys(dependencies);
  profileDependencies[name]=dependencies;
  profileRoots[name]=roots;for (const dep of roots) add(dep,`profile ${name}`);
}
for (const name of Object.keys(json(join(product,'package.json')).devDependencies || {})) if (name.startsWith('@ankdesh/')) add(name,'development checks');
mkdirSync(join(output,'packages'),{recursive:true});mkdirSync(join(output,'stage'),{recursive:true});
const packages=[];
async function packNode([name,node]) {
  const staged=join(output,'stage',name.replace('@deepseek-ai/',''));mkdirSync(staged,{recursive:true});
  const patterns=(node.manifest.files || ['lib']).filter(p=>p!=='src' && !p.startsWith('src/'));
  const included=new Set();
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    for (const path of globSync(pattern.replace(/\/$/,''),{cwd:node.directory})) included.add(path);
  }
  for (const file of readdirSync(node.directory)) if (/^(licen[cs]e|notice|copying|readme)(\.|$)/i.test(file)) included.add(file);
  for (const file of included) {
    if(file.startsWith('..')||file.startsWith('/'))throw new Error('Publication path escapes package');
    cpSync(join(node.directory,file),join(staged,file),{recursive:true,dereference:true});
  }
  if(!readdirSync(staged).some(file=>/^licen[cs]e(\.|$)/i.test(file))){
    let directory=node.directory,found=false;
    for(;;){
      const filename=readdirSync(directory).find(file=>/^licen[cs]e(\.|$)/i.test(file));
      if(filename){
        if(directory===root&&node.manifest.license&&node.manifest.license!==json(join(root,'package.json')).license)break;
        cpSync(join(directory,filename),join(staged,filename));found=true;break;
      }
      if(directory===root||relative(root,node.directory).startsWith('vendor/'))break;
      directory=dirname(directory);
    }
    if(!found)throw new Error(`Package must supply its own licence: ${name}`);
  }
  const manifest=structuredClone(node.manifest);manifest.name=rescope(name);manifest.version=versions.get(name);
  if(['@deepseek-ai/dsh','@deepseek-ai/dsh-web-frontend','@deepseek-ai/dsh-product-tools'].includes(name)||name.startsWith('@deepseek-ai/node-addon-system')){
    cpSync(join(root,'THIRD_PARTY_NOTICES.md'),join(staged,'THIRD_PARTY_NOTICES.md'));
    manifest.files=[...new Set([...(manifest.files||['lib']),'THIRD_PARTY_NOTICES.md'])];
  }
  for (const section of ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta']) if(manifest[section]) {
    manifest[section]=Object.fromEntries(Object.entries(manifest[section]).map(([key,value])=>[rescope(key),typeof value==='string'&&index.has(key)?versions.get(key):value]));
  }
  delete manifest.private;delete manifest.devDependencies;delete manifest.scripts;
  manifest.repository={type:'git',url:'git+https://github.com/ankdesh/deepseek-harness.git'};
  manifest.publishConfig={registry:'https://npm.pkg.github.com'};
  if(manifest.exports)for(const key of Object.keys(manifest.exports))if(key.startsWith('./src'))delete manifest.exports[key];
  // All text entry points, declarations, config metadata, and dynamic native names use one scope.
  for(const file of globSync('**/*',{cwd:staged,withFileTypes:true})) {
    if(!file.isFile())continue;const path=join(file.parentPath,file.name);
    if(/\.(js|mjs|cjs|ts|json|ya?ml|html|css|md)$/.test(path))writeFileSync(path,rescope(readFileSync(path,'utf8')));
  }
  if(manifest.dsh)manifest.dsh=JSON.parse(rescope(JSON.stringify(manifest.dsh)));
  writeFileSync(join(staged,'package.json'),rescope(JSON.stringify(manifest,null,2))+'\n');
  const result=JSON.parse((await capture('npm',['pack','--ignore-scripts','--json','--cache',join(output,'TEMP_npm_cache'),'--update-notifier=false','--pack-destination',join(output,'packages')],{cwd:staged,encoding:'utf8',env:{...process.env,npm_config_cache:join(output,'TEMP_npm_cache')}})))[0];
  if(!result.files.some(file=>/^licen[cs]e(\.|$)/i.test(file.path)))throw new Error(`Package archive is missing its licence: ${manifest.name}`);
  packages.push({name:manifest.name,version:manifest.version,file:result.filename,sha256:digest(readFileSync(join(output,'packages',result.filename))),integrity:result.integrity,downloadBytes:result.size,installedBytes:result.unpackedSize,
    licenceFiles:result.files.filter(file=>/^(licen[cs]e|notice|third_party_notices)(\.|$)/i.test(file.path)).map(file=>file.path),
    reasons:[...reasons.get(name)].sort(), dependencies:Object.fromEntries(Object.entries(manifest.dependencies||{}).filter(([n])=>n.startsWith('@ankdesh/'))),
    nativeFiles:result.files.filter(f=>/\.(node|so|dylib)$|\/bin\//.test(f.path)).map(f=>f.path),browserBytes:result.files.filter(f=>f.path.startsWith('dist/')||/lib\/client[^/]*\.js$/.test(f.path)).reduce((s,f)=>s+f.size,0)});
}
const pending=[...selected].sort(([a],[b])=>a.localeCompare(b));
await Promise.all(Array.from({length:4},async()=>{while(pending.length)await packNode(pending.shift());}));
packages.sort((a,b)=>a.name.localeCompare(b.name));
const profiles={};
for(const [name,roots] of Object.entries(profileRoots)) {
  const seen=new Set();const visit=n=>{if(seen.has(n))return;const p=packages.find(p=>p.name===n);if(!p)return;seen.add(n);const src=selected.get(sourceName(n)).manifest;for(const section of ['dependencies','peerDependencies','optionalDependencies'])for(const dep of Object.keys(src[section]||{})){if(section==='peerDependencies'&&src.peerDependenciesMeta?.[dep]?.optional)continue;visit(rescope(dep));}};
  roots.forEach(visit);const chosen=packages.filter(p=>seen.has(p.name));
  profiles[name]={roots:profileDependencies[name],packageCount:chosen.length,directCount:roots.length,downloadBytes:chosen.reduce((s,p)=>s+p.downloadBytes,0),installedBytes:chosen.reduce((s,p)=>s+p.installedBytes,0),browserBytes:chosen.reduce((s,p)=>s+p.browserBytes,0),packages:chosen.map(p=>p.name)};
  if(!values['stock-cli']&&name.endsWith('headless')&&chosen.some(p=>p.name.includes('dsh-client')||p.name==='@ankdesh/dsh-web-frontend'))throw new Error('Headless profile contains browser packages');
}
const sourceCommit=(await capture('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'})).trim();
const consumerCommit=(await capture('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'})).trim();
const consumerDirty=Boolean((await capture('git',['status','--porcelain'],{cwd:product,encoding:'utf8'})).trim());
if(consumerDirty&&!values['allow-dirty'])throw new Error('Release packing requires a clean consumer checkout.');
const manifest={schemaVersion:1,releaseId:versions.get('@deepseek-ai/dsh'),sourceCommit,sourceDirty:!!dirty,consumerCommit,consumerDirty,measurementOnly:!!values['stock-cli'],platform:'linux',arch:'x64',libc:'glibc',packages,profiles,measurementScope:'Harness archives only; external dependencies are measured by clean consumer verification'};
const bytes=JSON.stringify(manifest,null,2)+'\n';writeFileSync(join(output,'release-manifest.json'),bytes);writeFileSync(join(output,'release-manifest.sha256'),digest(bytes)+'\n');
console.log(JSON.stringify({packages:packages.length,profiles:Object.fromEntries(Object.entries(profiles).map(([n,p])=>[n,{packageCount:p.packageCount,directCount:p.directCount,downloadBytes:p.downloadBytes,installedBytes:p.installedBytes,browserBytes:p.browserBytes}])),manifestSha256:digest(bytes)}));
