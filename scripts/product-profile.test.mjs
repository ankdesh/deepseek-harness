/** Filesystem behavior of a product profile across development and release switches. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProductProfile } from './product-profile.mjs';

test('switching the product preserves its user patch and updates only the managed bundle link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try {
    const home = join(dir, 'state');
    for (const name of ['first', 'second']) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'package.json'), JSON.stringify({ name: '@test/product', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } } }));
    }
    prepareProductProfile(join(dir, 'first'), home);
    const profile = join(home, 'profiles/product');
    writeFileSync(join(profile, 'cordis.patch.yml'), '# operator patch\n[]\n');
    prepareProductProfile(join(dir, 'second'), home);
    assert.equal(realpathSync(join(profile, 'node_modules/@test/product')), join(dir, 'second'));
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), '# operator patch\n[]\n');
    assert.deepEqual(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dsh.profile.bundles, ['@test/product']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a non-bundle product is rejected before profile creation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try { writeFileSync(join(dir, 'package.json'), '{}'); assert.throws(() => prepareProductProfile(dir, join(dir, 'state')), /dsh.bundle.patch/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a real directory at the managed link is never replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'product', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } } }));
    const existing = join(dir, 'state/profiles/product/node_modules/product'); mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, 'keep'), 'operator data');
    assert.throws(() => prepareProductProfile(dir, join(dir, 'state')), /non-link/);
    assert.equal(readFileSync(join(existing, 'keep'), 'utf8'), 'operator data');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a dangling link is repaired without following its old target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'product', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } } }));
    const modules = join(dir, 'state/profiles/product/node_modules'); mkdirSync(modules, { recursive: true });
    symlinkSync(join(dir, 'missing'), join(modules, 'product'));
    prepareProductProfile(dir, join(dir, 'state'));
    assert.equal(realpathSync(join(modules, 'product')), dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a named layered profile links every local bundle in declared order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try {
    const root = join(dir, 'product'); mkdirSync(root);
    const core = join(root, 'core'); const web = join(root, 'web');
    for (const [directory, name] of [[core, '@test/core'], [web, '@test/web']]) {
      mkdirSync(directory);
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
      }));
    }
    const home = join(dir, 'state');
    prepareProductProfile(root, home, {
      profileName: 'spec2gds-web',
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@test/core', '@test/web'],
      localBundles: [core, web],
      patchReload: 'live',
    });
    const profile = join(home, 'profiles/spec2gds-web');
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dsh.profile, {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@test/core', '@test/web'],
      patchReload: 'live',
    });
    assert.equal(realpathSync(join(profile, 'node_modules/@test/core')), core);
    assert.equal(realpathSync(join(profile, 'node_modules/@test/web')), web);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a local bundle omitted from the ordered layers is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-profile-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: '@test/product', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } },
    }));
    assert.throws(() => prepareProductProfile(dir, join(dir, 'state'), {
      bundles: ['@deepseek-ai/dsh-base'],
    }), /absent from the ordered profile layers/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
