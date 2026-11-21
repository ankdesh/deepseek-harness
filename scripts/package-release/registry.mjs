/** A local read-only npm registry for clean checks of unpublished archives. */
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export async function archiveRegistry(release, directory) {
  const packages = new Map(release.packages.map(entry => {
    const archive = join(directory, entry.file);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], {encoding: 'utf8'}));
    if (manifest.name !== entry.name || manifest.version !== entry.version) {
      throw new Error(`Archive metadata differs: ${entry.name}@${entry.version}`);
    }
    return [entry.name, {entry, manifest}];
  }));
  const server=createServer((request,response)=>{
    const path=decodeURIComponent((request.url||'/').split('?')[0]);
    if(path.startsWith('/tarballs/')) {
      const file=path.slice('/tarballs/'.length);
      if(!release.packages.some(p=>p.file===file)){response.writeHead(404).end();return;}
      response.writeHead(200,{'content-type':'application/octet-stream'}).end(readFileSync(join(directory,file)));return;
    }
    const name=path.slice(1);const candidate=packages.get(name);
    if(!candidate){response.writeHead(404,{'content-type':'application/json'}).end(JSON.stringify({error:`No candidate package ${name}`}));return;}
    const {entry: p, manifest} = candidate;
    const base=`http://127.0.0.1:${server.address().port}`;
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({name,'dist-tags':{latest:p.version},versions:{[p.version]:{...manifest,dist:{tarball:base+'/tarballs/'+p.file,integrity:p.integrity}}}}));
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>server.close(done))};
}
