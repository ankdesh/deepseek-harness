import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {installedGraph,assembleProduct,sha256} from '../index.js';
const parent=resolve(import.meta.dirname,'../../../TEMP_product_tools');mkdirSync(parent,{recursive:true});
function fixture(){return mkdtempSync(join(parent,'consumer-'));}
function pkg(root,name,dependencies={},peers={}){const path=join(root,'node_modules',name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({name,version:'1.0.0',type:'module',dependencies,peerDependencies:peers}));writeFileSync(join(path,'index.js'),'export const value=42;\n');return path;}
test('assembly retains required peers and closes links inside the release',()=>{
 const root=fixture();try{
  pkg(root,'@ankdesh/a',{'@ankdesh/b':'1.0.0'});pkg(root,'@ankdesh/b',{}, {'@ankdesh/a':'1.0.0'});
  const graph=installedGraph(['@ankdesh/a'],root);assert.equal(graph.size,2);
  const bytes=JSON.stringify({releaseId:'test',sourceCommit:'test',packages:[{name:'@ankdesh/a',version:'1.0.0'},{name:'@ankdesh/b',version:'1.0.0'}]});
  writeFileSync(join(root,'manifest.json'),bytes);
  const output=join(root,'output');assembleProduct({from:root,output,roots:['@ankdesh/a'],releaseManifest:join(root,'manifest.json'),releaseManifestSha256:sha256(bytes)});
  const a=realpathSync(join(output,'node_modules/@ankdesh/a'));
  const b=realpathSync(join(a,'node_modules/@ankdesh/b'));
  assert.ok(a.startsWith(output+'/'));assert.ok(b.startsWith(output+'/'));
  assert.equal(realpathSync(join(b,'node_modules/@ankdesh/a')),a);
  assert.equal(JSON.parse(readFileSync(join(output,'release.json'))).packages.length,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a missing required package has an install diagnostic',()=>{const root=fixture();try{pkg(root,'app',{absent:'1.0.0'});assert.throws(()=>installedGraph(['app'],root),/Required package absent.*locked install/);}finally{rmSync(root,{recursive:true,force:true});}});
test('an optional dependency declaration does not hide a missing required peer',()=>{const root=fixture();try{
 const directory=pkg(root,'app',{}, {absent:'1.0.0'});const path=join(directory,'package.json');const manifest=JSON.parse(readFileSync(path,'utf8'));manifest.optionalDependencies={absent:'1.0.0'};writeFileSync(path,JSON.stringify(manifest));
 assert.throws(()=>installedGraph(['app'],root),/Required package absent/);
}finally{rmSync(root,{recursive:true,force:true});}});
test('a changed manifest cannot create a partial output',()=>{const root=fixture();try{writeFileSync(join(root,'manifest.json'),'{}');assert.throws(()=>assembleProduct({from:root,output:join(root,'output'),roots:[],releaseManifest:join(root,'manifest.json'),releaseManifestSha256:'wrong'}),/checksum/);assert.equal(existsSync(join(root,'output')),false);}finally{rmSync(root,{recursive:true,force:true});}});
test('local product assembly includes declared files and excludes local secrets',()=>{const root=fixture();try{
 const path=pkg(root,'product');writeFileSync(join(path,'package.json'),JSON.stringify({name:'product',version:'1.0.0',private:true,files:['lib']}));
 mkdirSync(join(path,'lib'));writeFileSync(join(path,'lib','index.js'),'export {};');writeFileSync(join(path,'.env'),'secret');
 const bytes=JSON.stringify({releaseId:'test',packages:[]});writeFileSync(join(root,'manifest.json'),bytes);
 const output=join(root,'output');assembleProduct({from:root,output,roots:['product'],releaseManifest:join(root,'manifest.json'),releaseManifestSha256:sha256(bytes)});
 assert.equal(existsSync(join(output,'node_modules/product/lib/index.js')),true);assert.equal(existsSync(join(output,'node_modules/product/.env')),false);
 }finally{rmSync(root,{recursive:true,force:true});}});
test('private products without an explicit file list cannot be assembled',()=>{const root=fixture();try{
 const path=pkg(root,'product');writeFileSync(join(path,'package.json'),JSON.stringify({name:'product',version:'1.0.0',private:true}));
 const bytes=JSON.stringify({releaseId:'test',packages:[]});writeFileSync(join(root,'manifest.json'),bytes);
 assert.throws(()=>assembleProduct({from:root,output:join(root,'output'),roots:['product'],releaseManifest:join(root,'manifest.json'),releaseManifestSha256:sha256(bytes)}),/must declare/);
 assert.equal(existsSync(join(root,'output')),false);
 }finally{rmSync(root,{recursive:true,force:true});}});
