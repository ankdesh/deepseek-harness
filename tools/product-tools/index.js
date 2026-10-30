/** Product preparation and portable assembly. No Harness checkout is required. */
import { createRequire } from 'node:module';
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
export { prepareProductProfile } from './profile.js';
/** Compute a release checksum.
 * @param {string|Uint8Array} bytes - Bytes or UTF-8 text to hash.
 * @returns {string} Hexadecimal SHA-256 checksum.
 */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Read metadata without validating its fields.
 * @param {string} path - JSON file to read.
 * @returns {unknown} Parsed data; the caller validates its fields.
 */
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

/** Resolve a declared package from an installation, including strict pnpm trees.
 * @param {string} name - Qualified package name.
 * @param {string} from - Directory of the package that declares the dependency.
 * @returns {string} Installed package directory.
 * @throws When the required package cannot be resolved.
 */
export function packageDirectory(name, from) {
  const require = createRequire(join(resolve(from), 'package.json'));
  try { return dirname(require.resolve(`${name}/package.json`)); }
  catch (error) {
    // Some third-party packages do not export their manifest. Search Node's package roots.
    for (const base of require.resolve.paths(name) || []) {
      const path = join(base, name);
      if (existsSync(join(path, 'package.json'))) return realpathSync(path);
    }
    throw new Error(`Required package ${name} is not installed from ${from}. Run the locked install; check GitHub Packages access.`, {cause: error});
  }
}

/** List dependencies, required peers, and optional dependencies.
 * @param {object} manifest - Installed package metadata.
 * @returns {string[]} Unique dependency names; availability is checked by installedGraph.
 */
export function installedEdges(manifest) {
  return [...new Set([...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}).filter(name => !manifest.peerDependenciesMeta?.[name]?.optional),
    ...Object.keys(manifest.optionalDependencies || {})])];
}

function optionalEdge(manifest,name) {
  const requiredPeer=Object.hasOwn(manifest.peerDependencies||{},name)&&!manifest.peerDependenciesMeta?.[name]?.optional;
  return Object.hasOwn(manifest.optionalDependencies||{},name)&&!requiredPeer;
}

/** Collect actual package identities; retain separate versions used by different consumers.
 * @param {string[]} roots - Declared product dependency roots.
 * @param {string} from - Consumer package directory.
 * @returns {Map} Physical package directories mapped to metadata and dependency edges.
 * @throws When a required dependency or peer is missing.
 */
export function installedGraph(roots, from) {
  const nodes = new Map();
  function add(name, parent, optional = false) {
    let directory;
    try { directory = realpathSync(packageDirectory(name, parent)); }
    catch (error) { if (optional) return; throw error; }
    if (nodes.has(directory)) return;
    const manifest = readJson(join(directory, 'package.json'));
    const node = {directory, manifest, edges: new Map()}; nodes.set(directory, node);
    for (const child of installedEdges(manifest)) {
      const target = add(child, directory, optionalEdge(manifest,child));
      if (target) node.edges.set(child, target);
    }
    return node;
  }
  // Record edges to already visited nodes too, including peer cycles.
  function walk(name, parent, optional) {
    try { return realpathSync(packageDirectory(name, parent)); }
    catch (error) { if (!optional) throw error; }
  }
  for (const name of roots) add(name, from);
  for (const node of nodes.values()) for (const name of installedEdges(node.manifest)) {
    const target = walk(name, node.directory, optionalEdge(node.manifest,name));
    if (target) node.edges.set(name, nodes.get(target));
  }
  return nodes;
}

/** Copy a locked installed graph, resolve links inside the output, and retain notices.
 * @param {object} options - Installation, new output path, roots, release manifest, and expected checksum.
 * @returns {object} Inventory of the assembled package names and versions.
 * @throws For an existing output, a mismatched release, missing dependencies, or unsafe private file lists.
 */
export function assembleProduct({from, output, roots, releaseManifest, releaseManifestSha256}) {
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const bytes = readFileSync(releaseManifest);
  if (!releaseManifestSha256 || sha256(bytes) !== releaseManifestSha256) throw new Error('Release manifest checksum does not match the product lock.');
  const release = JSON.parse(bytes);
  const graph = installedGraph(roots, from);
  for (const node of graph.values()) if (node.manifest.private === true) {
    if (!Array.isArray(node.manifest.files)) throw new Error(`Private package ${node.manifest.name} must declare its distribution files.`);
    for (const pattern of node.manifest.files) {
      if (typeof pattern !== 'string' || pattern.startsWith('!') || pattern.startsWith('/') || pattern.split('/').includes('..')) throw new Error(`Unsupported product file pattern in ${node.manifest.name}.`);
    }
  }
  for (const node of graph.values()) if (node.manifest.name.startsWith('@ankdesh/')) {
    const expected = release.packages.find(p => p.name === node.manifest.name);
    if (!expected || expected.version !== node.manifest.version) throw new Error(`Installed ${node.manifest.name} differs from the release manifest.`);
  }
  mkdirSync(output, {recursive: true});
  const inventory = [];
  // npm's flattened install is reproducible with an independent private store per package.
  let index = 0;
  for (const node of graph.values()) {
    node.output = join(output, 'node_modules/.store', String(index++), 'node_modules', node.manifest.name);
    mkdirSync(node.output, {recursive: true});
    const copyOptions = {recursive: true, dereference: true,
      filter: path => !relative(node.directory, path).split('/').includes('node_modules')};
    if (node.manifest.private === true && Array.isArray(node.manifest.files)) {
      // A product bundle can be a local source directory. Copy its declared
      // publication files, not local settings, tests, or credentials.
      const entries = new Set(['package.json']);
      for (const pattern of node.manifest.files) {
        for (const entry of globSync(pattern, {cwd: node.directory})) entries.add(entry);
      }
      for (const entry of readdirSync(node.directory)) if (/^(license|licence|notice|copying|readme)(\.|$)/i.test(entry)) entries.add(entry);
      for (const entry of entries) cpSync(join(node.directory, entry), join(node.output, entry), copyOptions);
    } else {
      cpSync(node.directory, node.output, copyOptions);
    }
    inventory.push({name: node.manifest.name, version: node.manifest.version});
  }
  // Managed links point only inside the release. The launcher and profile resolver use package metadata.
  const {symlinkSync} = createRequire(import.meta.url)('node:fs');
  const link = (target, path) => { mkdirSync(dirname(path), {recursive: true}); symlinkSync(relative(dirname(path), target), path, 'dir'); };
  const exposed = new Set();
  for (const node of graph.values()) {
    for (const [name, target] of node.edges) link(target.output, join(node.output, 'node_modules', name));
    if (!exposed.has(node.manifest.name)) {link(node.output, join(output, 'node_modules', node.manifest.name));exposed.add(node.manifest.name);}
  }
  writeFileSync(join(output, 'release.json'), JSON.stringify({releaseId: release.releaseId, sourceCommit: release.sourceCommit,
    platform: process.platform, arch: process.arch, packages: inventory}, null, 2)+'\n');
  writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), [...graph.values()].map(n => `${n.manifest.name}@${n.manifest.version}: ${n.manifest.license || 'See package licence files'}`).join('\n')+'\n');
  return {packages: inventory};
}
