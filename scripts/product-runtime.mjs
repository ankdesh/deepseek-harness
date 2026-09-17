/** Development and native release assembly for product-owned dsh profile bundles. */
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareProductProfile } from './product-profile.mjs';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, productArg, requestedProfile, ...profileArgs] = process.argv.slice(2);
if (mode !== 'dev' || !productArg) throw new Error('Usage: node scripts/product-runtime.mjs dev PRODUCT_DIRECTORY [PROFILE]');
const product = resolve(productArg);
const manifest = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'));
const recipePath = join(product, 'harness.product.json');
const recipe = existsSync(recipePath) ? JSON.parse(readFileSync(recipePath, 'utf8')) : undefined;
const configuredProfiles = recipe?.profiles;
let profiles;
if (configuredProfiles === undefined) {
  if (!manifest.dsh?.bundle?.patch) throw new Error('The product must declare dsh.bundle.patch in package.json');
  profiles = new Map([['product', { bundles: [manifest.name], localBundles: [product], patchReload: 'startup' }]]);
} else {
  if (typeof configuredProfiles !== 'object' || configuredProfiles === null || Array.isArray(configuredProfiles)) {
    throw new Error('harness.product.json profiles must be an object');
  }
  profiles = new Map(Object.entries(configuredProfiles).map(([profileName, profile]) => {
    if (!Array.isArray(profile?.bundles) || !Array.isArray(profile?.localBundles)) {
      throw new Error(`Product profile ${profileName} requires bundles and localBundles arrays`);
    }
    return [profileName, {
      bundles: profile.bundles,
      localBundles: profile.localBundles.map(directory => resolve(product, directory)),
      patchReload: profile.patchReload ?? 'startup',
    }];
  }));
  if (profiles.size === 0) throw new Error('harness.product.json profiles must not be empty');
}
const profileName = requestedProfile ?? recipe?.defaultProfile ?? profiles.keys().next().value;
if (!profiles.has(profileName)) throw new Error(`Unknown product profile ${JSON.stringify(profileName)}`);
const index = new Map();
for (const group of ['vendor', 'apps', 'native/system/packages', 'packages']) {
  for (const entry of readdirSync(join(harness, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(harness, group, entry.name);
    const dirs = group === 'packages' ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(dir, e.name)) : [dir];
    for (const candidate of dirs) if (existsSync(join(candidate, 'package.json'))) index.set(JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')).name, candidate);
  }
}
const productDirectories = new Set([product]);
for (const profile of profiles.values()) for (const directory of profile.localBundles) productDirectories.add(directory);
for (const directory of productDirectories) {
  const candidate = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  index.set(candidate.name, directory);
}
function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (realpathSync(path) === realpathSync(target)) return;
    if (!lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to replace non-link ${path}`);
    unlinkSync(path);
  }
  symlinkSync(target, path, 'dir');
}
for (const directory of productDirectories) {
  const candidate = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const name of Object.keys(candidate.dependencies || {})) {
    const target = index.get(name);
    if (!target) {
      if (existsSync(join(directory, 'node_modules', name, 'package.json')) || existsSync(join(product, 'node_modules', name, 'package.json'))) continue;
      throw new Error(`Install product-owned dependency ${name} before launching`);
    }
    link(target, join(directory, 'node_modules', name));
  }
}
const home = process.env.DSH_HOME;
if (!home) throw new Error('Set DSH_HOME to the product-owned state directory');
for (const [name, profile] of profiles) {
  prepareProductProfile(product, home, { profileName: name, ...profile });
}
const bin = join(harness, 'apps/cli/lib/bin.js');
if (!existsSync(bin)) throw new Error('Build the Harness host runtime first: pnpm run build:native-system && pnpm run build:lib:host');
const runCwd = process.env.DSH_PRODUCT_RUN_CWD ? resolve(process.env.DSH_PRODUCT_RUN_CWD) : product;
if (!existsSync(runCwd)) throw new Error(`Product run directory does not exist: ${runCwd}`);
const child = spawn(process.execPath, [bin, '--profile', profileName, ...profileArgs], { cwd: runCwd, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
