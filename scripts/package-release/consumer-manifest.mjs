/** Apply candidate Harness versions without changing the application's source manifest.
 * @param {object} source - Consumer package metadata.
 * @param {Map<string,string>} versions - Available candidate package versions.
 * @returns {object} A copied manifest with exact Harness versions.
 * @throws When the candidate omits a declared Harness dependency.
 */
export function candidateManifest(source,versions){
  const manifest=structuredClone(source);
  for(const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies'])for(const name of Object.keys(manifest[section]||{}))if(name.startsWith('@ankdesh/')){
    if(!versions.has(name))throw new Error(`Candidate omits declared consumer dependency ${name}`);
    manifest[section][name]=versions.get(name);
  }
  return manifest;
}

/** Collect production roots without dropping an application's third-party dependencies.
 * @param {object[]} manifests - Selected local bundle manifests.
 * @param {Map<string,string>} versions - Released Harness package names and versions.
 * @returns {object} Registry dependency declarations for the production lock.
 * @throws For missing Harness packages, local source dependencies, or conflicting external declarations.
 */
export function productRoots(manifests,versions){
  const roots={};
  const add=(name,specification)=>{
    const version=name.startsWith('@ankdesh/')?versions.get(name):specification;
    if(!version)throw new Error(`Candidate omits declared consumer dependency ${name}`);
    if(/^(file:|link:|workspace:)/.test(version))throw new Error(`Production dependency ${name} requires a registry release.`);
    if(roots[name]&&roots[name]!==version)throw new Error(`Conflicting product dependency declarations for ${name}. Use compatible registry roots.`);
    roots[name]=version;
  };
  for(const name of ['@ankdesh/dsh','@ankdesh/ankdesh-product-tools'])add(name,versions.get(name));
  for(const manifest of manifests)for(const [name,version]of Object.entries(manifest.dependencies||{}))add(name,version);
  return Object.fromEntries(Object.entries(roots).sort(([a],[b])=>a.localeCompare(b)));
}
