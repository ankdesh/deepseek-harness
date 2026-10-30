/** A local read-only npm registry for clean checks of unpublished archives. */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export async function archiveRegistry(release, directory) {
  const packages=new Map(release.packages.map(p=>[p.name,p]));
  const server=createServer((request,response)=>{
    const path=decodeURIComponent((request.url||'/').split('?')[0]);
    if(path.startsWith('/tarballs/')) {
      const file=path.slice('/tarballs/'.length);
      if(!release.packages.some(p=>p.file===file)){response.writeHead(404).end();return;}
      response.writeHead(200,{'content-type':'application/octet-stream'}).end(readFileSync(join(directory,file)));return;
    }
    const name=path.slice(1);const p=packages.get(name);
    if(!p){response.writeHead(404,{'content-type':'application/json'}).end(JSON.stringify({error:`No candidate package ${name}`}));return;}
    const manifest=JSON.parse(readFileSync(join(directory,'../stage',name.slice('@ankdesh/'.length),'package.json'),'utf8'));
    const base=`http://127.0.0.1:${server.address().port}`;
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({name,'dist-tags':{latest:p.version},versions:{[p.version]:{...manifest,dist:{tarball:base+'/tarballs/'+p.file,integrity:p.integrity}}}}));
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>server.close(done))};
}
