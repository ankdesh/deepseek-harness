/** Assemble a native dsh product from built artifacts and their installed dependency graph. */
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [productArg, outputArg] = process.argv.slice(2);
if (!productArg || !outputArg) throw new Error('Usage: node scripts/product-pack.mjs PRODUCT_DIRECTORY NEW_OUTPUT_DIRECTORY');
const product = realpathSync(resolve(productArg)), output = resolve(outputArg);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const productManifest = json(join(product, 'package.json'));
const lock = json(join(product, 'harness.lock.json'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harness, encoding: 'utf8' }).trim();
if (head !== lock.commit) throw new Error('Harness HEAD differs from the product lock. Test the upgrade and update harness.lock.json first.');
const cli = realpathSync(join(harness, 'apps/cli'));
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const cliImports = new Set();
for (const file of globSync('lib/*.js', { cwd: cli })) {
  const source = ts.createSourceFile(file, readFileSync(join(cli, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !builtins.has(specifier)) cliImports.add(packageName(specifier));
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (!cliImports.has('@deepseek-ai/dsh-app-boot')) throw new Error('Missing built dsh profile boot import; rebuild the host runtime');
const harnessPackages = new Map();
for (const group of ['vendor', 'apps', 'native/system/packages', 'packages']) {
  for (const entry of readdirSync(join(harness, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(harness, group, entry.name);
    const candidates = group === 'packages'
      ? readdirSync(directory, { withFileTypes: true }).filter(candidate => candidate.isDirectory()).map(candidate => join(directory, candidate.name))
      : [directory];
    for (const candidate of candidates) {
      if (!existsSync(join(candidate, 'package.json'))) continue;
      harnessPackages.set(json(join(candidate, 'package.json')).name, realpathSync(candidate));
    }
  }
}
function locate(name, from) {
  const pinned = harnessPackages.get(name);
  if (pinned !== undefined) return pinned;
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}
function supports(values, current) { return !values || (!values.includes(`!${current}`) && (values.every(v => v.startsWith('!')) || values.includes(current) || values.includes('any'))); }
function link(target, path) { mkdirSync(dirname(path), { recursive: true }); symlinkSync(relative(dirname(path), target), path, 'dir'); }
const nodes = new Map();
const libc = process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
function add(source) {
  if (nodes.has(source)) return nodes.get(source);
  const manifest = json(join(source, 'package.json'));
  const id = `p${String(nodes.size).padStart(4, '0')}`;
  const dest = join(output, 'node_modules', '.store', id, 'node_modules', manifest.name);
  const node = { source, manifest, dest, dependencies: new Map() }; nodes.set(source, node);
  const required = new Set(Object.keys(manifest.dependencies || {}));
  if (source === cli) { required.clear(); for (const name of cliImports) required.add(name); }
  for (const name of Object.keys(manifest.peerDependencies || {})) if (!manifest.peerDependenciesMeta?.[name]?.optional) required.add(name);
  const optional = Object.keys(manifest.optionalDependencies || {});
  for (const name of optional) required.delete(name);
  for (const name of [...new Set([...required, ...optional])].sort()) {
    const target = locate(name, source);
    if (!target) { if (optional.includes(name)) continue; throw new Error(`Missing required dependency ${name} of ${manifest.name}`); }
    const peer = json(join(target, 'package.json'));
    if (optional.includes(name) && (!supports(peer.os, process.platform) || !supports(peer.cpu, process.arch) || !supports(peer.libc, libc))) continue;
    node.dependencies.set(name, add(target));
  }
  return node;
}
mkdirSync(output, { recursive: true });
add(product); add(cli);
for (const node of nodes.values()) {
  const { source, dest, manifest } = node;
  mkdirSync(dest, { recursive: true });
  const workspace = source.startsWith(`${harness}${sep}`) && !source.includes(`${sep}node_modules${sep}`)
    || source === product || source.startsWith(`${product}${sep}`);
  const entries = workspace ? new Set(['lib', ...((manifest.files || []).flatMap(pattern => globSync(pattern, { cwd: source }))), ...readdirSync(source).filter(name => /^(license|licence|notice|copying|readme)(\.|$)/i.test(name))]) : new Set(readdirSync(source).filter(name => name !== 'node_modules'));
  for (const entry of entries) {
    if (entry === 'package.json' || !existsSync(join(source, entry))) continue;
    if (entry.startsWith('..') || entry.startsWith('/')) throw new Error(`Package file escapes package: ${entry}`);
    cpSync(join(source, entry), join(dest, entry), { recursive: true, dereference: true, filter: path => !relative(source, path).split(sep).includes('node_modules') });
  }
  const copied = { ...manifest, dependencies: Object.fromEntries([...node.dependencies].map(([name, dependency]) => [name, dependency.manifest.version])) };
  delete copied.devDependencies; delete copied.optionalDependencies; delete copied.peerDependencies; delete copied.peerDependenciesMeta; delete copied.scripts;
  if (source === cli) delete copied.dsh;
  writeFileSync(join(dest, 'package.json'), JSON.stringify(copied, null, 2) + '\n');
  for (const [name, dependency] of node.dependencies) link(dependency.dest, join(dest, 'node_modules', name));
}
// Cordis also performs bare dynamic imports from its loader package. Expose
// the selected graph at the install root while preserving nearest dependency links.
const exposed = new Set();
for (const node of nodes.values()) {
  if (exposed.has(node.manifest.name)) continue;
  exposed.add(node.manifest.name);
  link(node.dest, join(output, 'node_modules', node.manifest.name));
}
const recipe = json(join(product, 'harness.product.json'));
if (recipe.schemaVersion !== 1 || !Array.isArray(recipe.releaseFiles)) throw new Error('Expected a schemaVersion 1 product recipe with releaseFiles');
for (const file of recipe.releaseFiles) {
  if (typeof file !== 'string' || file.startsWith('/') || file.split(/[\\/]/).includes('..')) throw new Error('Release files must stay inside the product directory');
  cpSync(join(product, file), join(output, file), { recursive: true });
}
mkdirSync(join(output, 'deployment'), { recursive: true });
cpSync(join(harness, 'scripts/product-profile.mjs'), join(output, 'deployment/harness-profile.mjs'));
const packages = [...nodes.values()].map(n => ({ name: n.manifest.name, version: n.manifest.version, license: n.manifest.license || 'SEE PACKAGE NOTICES' }));
writeFileSync(join(output, 'release.json'), JSON.stringify({ application: productManifest.name, version: productManifest.version, harnessCommit: head, harnessLockSha256: createHash('sha256').update(readFileSync(join(harness, 'pnpm-lock.yaml'))).digest('hex'), packagerSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), harnessDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: harness, encoding: 'utf8' }).trim(), platform: process.platform, arch: process.arch, libc, node: lock.node, packages }, null, 2) + '\n');
writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), packages.map(p => `${p.name}@${p.version}: ${p.license}; license files are beside each package.`).join('\n') + '\n');
const checksums = [];
function inventory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = realpathSync(path); if (!target.startsWith(`${output}${sep}`)) throw new Error(`Release link escapes output: ${path}`);
    } else if (entry.isDirectory()) inventory(path);
    else checksums.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(output, path)}`);
  }
}
inventory(output);
writeFileSync(join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
execFileSync('tar', ['-czf', `${output}.tar.gz`, '-C', dirname(output), output.split(sep).at(-1)]);
console.log(JSON.stringify({ directory: output, archive: `${output}.tar.gz`, packages: packages.length, archiveBytes: statSync(`${output}.tar.gz`).size }, null, 2));
