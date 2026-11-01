import test from 'node:test';import assert from 'node:assert/strict';
import {candidateManifest} from '../consumer-manifest.mjs';
test('an upgrade verifies candidate versions while retaining third-party declarations and source bytes',()=>{
 const source={dependencies:{'@ankdesh/dsh':'0.1.6-ankdesh.1',openai:'^6'},devDependencies:{'@ankdesh/dsh-product-tools':'0.1.6-ankdesh.1'}};
 const result=candidateManifest(source,new Map([['@ankdesh/dsh','0.1.6-ankdesh.2'],['@ankdesh/dsh-product-tools','0.1.6-ankdesh.2']]));
 assert.equal(result.dependencies['@ankdesh/dsh'],'0.1.6-ankdesh.2');assert.equal(result.devDependencies['@ankdesh/dsh-product-tools'],'0.1.6-ankdesh.2');assert.equal(result.dependencies.openai,'^6');assert.equal(source.dependencies['@ankdesh/dsh'],'0.1.6-ankdesh.1');
});
test('missing candidate packages fail before a registry fallback can be used',()=>{assert.throws(()=>candidateManifest({dependencies:{'@ankdesh/missing':'old'}},new Map()),/Candidate omits declared/);});

test('production roots retain third-party application dependencies',async()=>{
 const {productRoots}=await import('../consumer-manifest.mjs');
 const versions=new Map([['@ankdesh/dsh','release'],['@ankdesh/ankdesh-product-tools','release']]);
 assert.equal(productRoots([{dependencies:{zod:'^4.4.3'}}],versions).zod,'^4.4.3');
});
test('conflicting third-party roots require an explicit compatible declaration',async()=>{
 const {productRoots}=await import('../consumer-manifest.mjs');
 const versions=new Map([['@ankdesh/dsh','release'],['@ankdesh/ankdesh-product-tools','release']]);
 assert.throws(()=>productRoots([{dependencies:{zod:'^3'}},{dependencies:{zod:'^4'}}],versions),/Conflicting product dependency/);
});
test('production roots reject application source links',async()=>{
 const {productRoots}=await import('../consumer-manifest.mjs');
 const versions=new Map([['@ankdesh/dsh','release'],['@ankdesh/ankdesh-product-tools','release']]);
 assert.throws(()=>productRoots([{dependencies:{local:'file:../local'}}],versions),/requires a registry release/);
});
