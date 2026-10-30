import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {installedPackages,measureInstallation} from '../measure.mjs';
const parent=resolve(import.meta.dirname,'../../../TEMP_release_tests');mkdirSync(parent,{recursive:true});
function fixture(t){const root=mkdtempSync(join(parent,'measurement-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function write(path,value){mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));}
test('measurement includes a physically installed optional peer outside declared roots',t=>{
 const root=fixture(t),cache=join(root,'cache');write(join(root,'package.json'),{dependencies:{runtime:'1.0.0'}});
 write(join(root,'node_modules/runtime/package.json'),{name:'runtime',version:'1.0.0'});
 write(join(root,'node_modules/browser-peer/package.json'),{name:'browser-peer',version:'1.0.0',dsh:{client:{}}});write(join(root,'node_modules/browser-peer/lib/client.js'),'browser');
 const archive=Buffer.from('archive'),digest=createHash('sha512').update(archive).digest(),hex=digest.toString('hex');
 write(join(cache,'_cacache/content-v2/sha512',hex.slice(0,2),hex.slice(2,4),hex.slice(4)),archive.toString());
 const integrity='sha512-'+digest.toString('base64');write(join(root,'package-lock.json'),{packages:{'node_modules/runtime':{integrity},'node_modules/browser-peer':{integrity}}});
 const measured=measureInstallation(root,cache);assert.equal(installedPackages(root).size,2);assert.equal(measured.installedPackageCount,2);assert.equal(measured.indirectPackageCount,1);assert.equal(measured.downloadBytes,archive.length);assert.equal(measured.browserAssetBytes,7);
});
test('an unavailable archive size is reported as incomplete download coverage',t=>{
 const root=fixture(t);write(join(root,'package.json'),{dependencies:{runtime:'1.0.0'}});write(join(root,'node_modules/runtime/package.json'),{name:'runtime',version:'1.0.0'});write(join(root,'package-lock.json'),{packages:{'node_modules/runtime':{integrity:'sha512-YWJjZA=='}}});
 const measured=measureInstallation(root,join(root,'cache'));assert.equal(measured.downloadBytes,null);assert.deepEqual(measured.missingDownloadSizes,['runtime@1.0.0']);
});
