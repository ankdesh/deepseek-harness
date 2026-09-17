/** Development and native release assembly for product-owned dsh profile bundles. */
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareProductProfile } from './product-profile.mjs';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, productArg] = process.argv.slice(2);
if (mode !== 'dev' || !productArg) throw new Error('Usage: node scripts/product-runtime.mjs dev PRODUCT_DIRECTORY');
const product = resolve(productArg);
const manifest = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'));
if (!manifest.dsh?.bundle?.patch) throw new Error('The product must declare dsh.bundle.patch in package.json');
const index = new Map();
for (const group of ['vendor', 'apps', 'native/system/packages', 'packages']) {
  for (const entry of readdirSync(join(harness, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(harness, group, entry.name);
    const dirs = group === 'packages' ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(dir, e.name)) : [dir];
    for (const candidate of dirs) if (existsSync(join(candidate, 'package.json'))) index.set(JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')).name, candidate);
  }
}
index.set(manifest.name, product);
function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (realpathSync(path) === realpathSync(target)) return;
    if (!lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to replace non-link ${path}`);
    unlinkSync(path);
  }
  symlinkSync(target, path, 'dir');
}
for (const name of Object.keys(manifest.dependencies || {})) {
  const target = index.get(name);
  if (!target) {
    if (existsSync(join(product, 'node_modules', name, 'package.json'))) continue;
    throw new Error(`Install product-owned dependency ${name} before launching`);
  }
  link(target, join(product, 'node_modules', name));
}
const home = process.env.DSH_HOME;
if (!home) throw new Error('Set DSH_HOME to the product-owned state directory');
prepareProductProfile(product, home);
const bin = join(harness, 'apps/cli/lib/bin.js');
if (!existsSync(bin)) throw new Error('Build the Harness host runtime first: pnpm run build:native-system && pnpm run build:lib:host');
const child = spawn(process.execPath, [bin, '--profile', 'product'], { cwd: product, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
