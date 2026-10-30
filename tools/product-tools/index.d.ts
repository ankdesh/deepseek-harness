/** Options for preparing a named product profile from installed bundle metadata. */
export interface ProductProfileOptions {
  profileName?: string;
  bundles?: string[];
  localBundles?: string[];
  patchReload?: 'live' | 'startup';
}
/** Package metadata needed to resolve and assemble an installed dependency graph. */
export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, {optional?: boolean}>;
  optionalDependencies?: Record<string, string>;
}
/** One physical package identity and its resolved dependencies. */
export interface InstalledPackage {
  directory: string;
  manifest: PackageManifest;
  edges: Map<string, InstalledPackage>;
}
/** Resolve an installed package through its public manifest or Node package roots. */
export function packageDirectory(name: string, from: string): string;
/** Return dependency names, including required peers and optional dependencies. */
export function installedEdges(manifest: PackageManifest): string[];
/** Return the installed dependency graph; throw when a required package is absent. */
export function installedGraph(roots: string[], from: string): Map<string, InstalledPackage>;
/** Prepare managed bundle links and preserve any existing user profile patch. */
export function prepareProductProfile(product: string, home: string, options?: ProductProfileOptions): void;
/** Compute the hexadecimal SHA-256 checksum of bytes or UTF-8 text. */
export function sha256(bytes: string | Uint8Array): string;
/** Read a JSON file; the caller validates its data before use. */
export function readJson(path: string): unknown;
/** Assemble declared distribution files and a complete dependency graph in a new directory. */
export function assembleProduct(options: {
  from: string;
  output: string;
  roots: string[];
  releaseManifest: string;
  releaseManifestSha256: string;
}): {packages: Array<{name: string; version: string}>};
