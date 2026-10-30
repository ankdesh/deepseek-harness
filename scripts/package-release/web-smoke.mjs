/** Start the assembled web release and fetch its boot page and browser entry assets. */
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.argv[2]&&resolve(process.argv[2]);if(!root)throw new Error('Usage: web-smoke.mjs ASSEMBLED_RELEASE_DIRECTORY');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(done=>reservation.close(done));
const env={...process.env,ASSISTANT_STATE:resolve(root,'TEMP_smoke_state'),ASSISTANT_HOST:'127.0.0.1',ASSISTANT_PORT:String(port)};
const child=spawn(process.execPath,[resolve(root,'deployment/launch.mjs'),'--no-open'],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',bytes=>{log+=bytes;});child.stderr.on('data',bytes=>{log+=bytes;});
const completed=new Promise((done,fail)=>{child.on('error',fail);child.on('close',done);});
const signal=value=>{try{process.kill(-child.pid,value);}catch(error){if(error.code!=='ESRCH')throw error;}};
try{
 const deadline=Date.now()+60000;let match;
 while(!(match=/^dsh web: (http:\/\/\S+)/m.exec(log))){
  if(child.exitCode!==null||child.signalCode!==null)throw new Error('Assembled web release exited before readiness.');
  if(Date.now()>deadline)throw new Error('Assembled web release did not announce readiness within 60 seconds.');
  await delay(100);
 }
 if(new URL(match[1]).origin!==`http://127.0.0.1:${port}`)throw new Error('Assembled web readiness URL does not match the private test port.');
 let response=await fetch(match[1],{redirect:'manual',signal:AbortSignal.timeout(5000)});
 const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const headers=cookie?{cookie}:{};
 if(response.status>=300&&response.status<400)response=await fetch(new URL(response.headers.get('location'),match[1]),{headers,signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error(`Assembled web page returned ${response.status}`);
 const html=await response.text();if(!html.includes('__DSH_BOOT__'))throw new Error('Assembled web page has no Harness boot metadata.');
 const sources=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m=>m[1].replaceAll('&amp;','&'));
 if(!sources.length)throw new Error('Assembled web page has no browser entry script.');
 for(const source of sources){
  const url=new URL(source,match[1]);if(url.origin!==new URL(match[1]).origin)throw new Error('Browser entry asset is outside the assembled release origin.');
  const asset=await fetch(url,{headers,signal:AbortSignal.timeout(5000)});
  if(!asset.ok||!/(?:java|ecma)script/i.test(asset.headers.get('content-type')||'')||(await asset.text()).length===0)throw new Error(`Browser entry asset could not be loaded: ${source}`);
 }
 console.log('Assembled web release reached readiness and served its boot page and browser scripts.');
}finally{
 signal('SIGTERM');let settled=false;completed.finally(()=>{settled=true;}).catch(()=>{});
 await Promise.race([completed,delay(5000)]);if(!settled){signal('SIGKILL');await completed;}signal('SIGKILL');
 writeFileSync(resolve(root,'web-startup.log'),log.replace(/([?&](?:token|access_token|api_key|key|auth)=)[^&\s"'<>]+/gi,'$1[REDACTED]'));
}
