/** Compose product-owned bundles into a dedicated normal dsh profile. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** @typedef {{ profileName?: string, bundles?: string[], localBundles?: string[], patchReload?: 'live' | 'startup' }} ProductProfileOptions */

function readBundle(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (!manifest.name || !manifest.version || !manifest.dsh?.bundle?.patch) {
    throw new Error(`Product bundle ${directory} must declare name, version, and dsh.bundle.patch`);
  }
  return { directory, manifest };
}

function replaceManagedLink(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace non-link ${path}`);
    if (!existsSync(path) || realpathSync(path) !== realpathSync(target)) unlinkSync(path);
  }
  if (!existsSync(path)) symlinkSync(relative(dirname(path), target), path, 'dir');
}

/**
 * Prepare one product profile and its bundle links; preserve an existing user patch.
 * @param {string} product - Absolute product root package directory.
 * @param {string} home - Absolute product-owned Harness state directory.
 * @param {ProductProfileOptions} [options] - Profile identity, ordered layers, and local bundle directories.
 * @returns {void} Writes the profile manifest and managed link.
 * @throws If a package is not a bundle, a layer is missing, or an unmanaged path occupies a managed link.
 */
export function prepareProductProfile(product, home, options = {}) {
  const profileName = options.profileName ?? 'product';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(profileName)) throw new Error(`Invalid product profile name ${JSON.stringify(profileName)}`);
  const directories = options.localBundles ?? [product];
  if (directories.length === 0) throw new Error('A product profile requires at least one local bundle');
  const locals = directories.map(readBundle);
  const localNames = locals.map(bundle => bundle.manifest.name);
  if (new Set(localNames).size !== localNames.length) throw new Error('Product profile local bundle names must be unique');
  const bundles = options.bundles ?? localNames;
  if (bundles.length === 0 || bundles.some(name => typeof name !== 'string' || name.trim() === '')) {
    throw new Error('Product profile bundles must be a non-empty list of package names');
  }
  if (new Set(bundles).size !== bundles.length) throw new Error('Product profile bundle names must be unique');
  for (const name of localNames) {
    if (!bundles.includes(name)) throw new Error(`Local product bundle ${name} is absent from the ordered profile layers`);
  }
  const localByName = new Map(locals.map(bundle => [bundle.manifest.name, bundle]));
  const selected = bundles.map(name => {
    const local = localByName.get(name);
    if (local !== undefined) return local;
    const installed = join(product, 'node_modules', name);
    if (!existsSync(join(installed, 'package.json'))) {
      throw new Error(`Product profile bundle ${name} is neither local nor installed by the product`);
    }
    const bundle = readBundle(installed);
    if (bundle.manifest.name !== name) throw new Error(`Installed product profile bundle ${name} has package name ${bundle.manifest.name}`);
    return bundle;
  });
  const patchReload = options.patchReload ?? 'startup';
  if (patchReload !== 'live' && patchReload !== 'startup') throw new Error('Product profile patchReload must be "live" or "startup"');

  const profile = join(home, 'profiles', profileName); mkdirSync(profile, { recursive: true });
  for (const bundle of selected) {
    replaceManagedLink(bundle.directory, join(profile, 'node_modules', bundle.manifest.name));
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: `${profileName}-product-profile`,
    private: true,
    dependencies: Object.fromEntries(selected.map(bundle => [bundle.manifest.name, bundle.manifest.version])),
    dsh: { profile: { bundles, patchReload } },
  }, null, 2) + '\n');
  const patch = join(profile, 'cordis.patch.yml');
  if (!existsSync(patch)) writeFileSync(patch, '[]\n');
}
