/** Compose a product-owned bundle into a dedicated normal dsh profile. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Prepare the profile and bundle link; preserve an existing user patch.
 * @param {string} product - Absolute product package directory.
 * @param {string} home - Absolute product-owned Harness state directory.
 * @returns {void} Writes the profile manifest and managed link.
 * @throws If the product is not a bundle or an unmanaged directory occupies its link.
 */
export function prepareProductProfile(product, home) {
  const manifest = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'));
  if (!manifest.dsh?.bundle?.patch) throw new Error('The product must declare dsh.bundle.patch');
  const profile = join(home, 'profiles', 'product'); mkdirSync(profile, { recursive: true });
  const link = join(profile, 'node_modules', manifest.name); mkdirSync(dirname(link), { recursive: true });
  let stat;
  try { stat = lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace non-link ${link}`);
    if (!existsSync(link) || realpathSync(link) !== realpathSync(product)) unlinkSync(link);
  }
  if (!existsSync(link)) symlinkSync(relative(dirname(link), product), link, 'dir');
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'product-profile', private: true, dependencies: { [manifest.name]: manifest.version }, dsh: { profile: { bundles: [manifest.name], patchReload: 'startup' } } }, null, 2) + '\n');
  const patch = join(profile, 'cordis.patch.yml');
  if (!existsSync(patch)) writeFileSync(patch, '[]\n');
}
