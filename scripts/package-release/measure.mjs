/** Measure the complete physical npm installation, including packages outside the runtime graph. */
import {existsSync,readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';

/** Return all installed package directories, including nested versions and optional peers.
 * @param {string} root - Consumer installation directory.
 * @returns {Map<string, object>} Package directories indexed by physical path.
 */
export function installedPackages(root) {
  const packages=new Map();
  function add(directory){
    const physical=realpathSync(directory);if(packages.has(physical))return;
    const manifestPath=join(physical,'package.json');if(!existsSync(manifestPath))return;
    packages.set(physical,JSON.parse(readFileSync(manifestPath,'utf8')));scan(join(physical,'node_modules'));
  }
  function scan(directory){
    if(!existsSync(directory))return;
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const path=join(directory,entry.name);
      if(entry.name.startsWith('@')){for(const child of readdirSync(path))add(join(path,child));}
      else add(path);
    }
  }
  scan(join(root,'node_modules'));return packages;
}

/** Measure installed payloads and cached downloads; report unavailable archive sizes explicitly.
 * @param {string} root - Consumer installation directory.
 * @param {string} cache - npm cache used by the clean installation.
 * @returns {object} Counts, file bytes, native files, and download coverage.
 */
export function measureInstallation(root,cache){
  const packages=installedPackages(root),lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
  const direct=Object.keys(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).dependencies||{});
  const inventory=[];let installedBytes=0,browserAssetBytes=0,knownDownloadBytes=0;
  const downloads=new Set(),missingDownloadSizes=[];
  for(const [directory,manifest]of packages){
    let bytes=0;const nativeFiles=[];
    const browserPackage=Boolean(manifest.dsh?.client||manifest.name==='@ankdesh/dsh-web-frontend'||manifest.name==='@spec2gds/harness-web');
    function files(path){
      for(const entry of readdirSync(path,{withFileTypes:true})){
        if(entry.name==='node_modules')continue;
        const file=join(path,entry.name),name=relative(directory,file);
        if(entry.isDirectory())files(file);
        else if(entry.isFile()){
          const size=statSync(file).size;bytes+=size;
          if(browserPackage&&(name.startsWith('dist/')||/^lib\/client[^/]*\.js$/.test(name)))browserAssetBytes+=size;
          if(/\.(node|so|dylib)$/.test(name))nativeFiles.push(name);
        }
      }
    }
    files(directory);installedBytes+=bytes;
    const locked=lock.packages?.[relative(root,directory).split('\\').join('/')];
    if(locked?.integrity){
      const integrity=locked.integrity.split(' ').find(v=>v.startsWith('sha512-'));
      if(integrity&&!downloads.has(integrity)){
        downloads.add(integrity);const digest=Buffer.from(integrity.slice(7),'base64').toString('hex');
        const content=join(cache,'_cacache/content-v2/sha512',digest.slice(0,2),digest.slice(2,4),digest.slice(4));
        if(existsSync(content))knownDownloadBytes+=statSync(content).size;else missingDownloadSizes.push(`${manifest.name}@${manifest.version}`);
      }else if(!integrity)missingDownloadSizes.push(`${manifest.name}@${manifest.version}`);
    }else if(!manifest.private)missingDownloadSizes.push(`${manifest.name}@${manifest.version}`);
    inventory.push({name:manifest.name,version:manifest.version,installedBytes:bytes,nativeFiles,source:manifest.private?'application-build':'npm'});
  }
  return {scope:'All physical npm packages plus built application bundles; excludes npm cache and generated runtime state',platform:process.platform,arch:process.arch,directRegistryDependencies:direct.length,installedPackageCount:packages.size,indirectPackageCount:inventory.filter(p=>!direct.includes(p.name)&&p.source!=='application-build').length,localBundleCount:inventory.filter(p=>p.source==='application-build').length,installedBytes,browserAssetBytes,browserMetric:'dist/ and lib/client*.js in browser modules, frontend, and product web bundle; excludes protocol clients and does not measure network transfer',downloadBytes:missingDownloadSizes.length?null:knownDownloadBytes,knownDownloadBytes,missingDownloadSizes,packages:inventory.sort((a,b)=>a.name.localeCompare(b.name))};
}
