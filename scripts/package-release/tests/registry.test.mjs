import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {archiveRegistry} from '../registry.mjs';

test('serves renamed package metadata from the archive without a staging directory', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-candidate-registry-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const name = '@ankdesh/ankdesh-flow';
  const version = '0.1.6-ankdesh.1';
  const file = 'flow.tgz';
  const manifest = {name, version, dependencies: {'@ankdesh/cordis': version}};
  mkdirSync(join(root, 'package'));
  writeFileSync(join(root, 'package/package.json'), JSON.stringify(manifest));
  execFileSync('tar', ['-czf', join(root, file), '-C', root, 'package']);
  const registry = await archiveRegistry({packages: [{name, version, file}]}, root);
  t.after(() => registry.close());

  const response = await fetch(registry.url + '/' + encodeURIComponent(name));
  assert.equal(response.status, 200);
  const metadata = (await response.json()).versions[version];
  assert.deepEqual(metadata.dependencies, manifest.dependencies);
  const archive = await fetch(metadata.dist.tarball);
  assert.equal(archive.status, 200);
  assert.deepEqual(Buffer.from(await archive.arrayBuffer()), readFileSync(join(root, file)));
  await assert.rejects(archiveRegistry({packages: [{name, version: '0.0.0', file}]}, root), /Archive metadata differs/);
});
