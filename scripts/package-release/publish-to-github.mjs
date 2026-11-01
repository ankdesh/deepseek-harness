import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const directory = resolve(process.argv[2] || import.meta.dirname);
const manifestPath = join(directory, 'release-manifest.json');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const hash = (bytes, algo = 'sha256') => createHash(algo).update(bytes).digest(algo === 'sha512' ? 'base64' : 'hex');

if (!process.env.NODE_AUTH_TOKEN) throw new Error('NODE_AUTH_TOKEN is required');

async function npm(args) {
  const temp = mkdtempSync(join(directory, 'TEMP_pub-'));
  const stdout = join(temp, 'stdout');
  const stderr = join(temp, 'stderr');
  const out = openSync(stdout, 'w');
  const err = openSync(stderr, 'w');
  try {
    const code = await new Promise((done, fail) => {
      const child = spawn('npm', [...args, '--registry=https://npm.pkg.github.com', '--cache', join(directory, 'TEMP_npm_cache')], {
        env: process.env,
        stdio: ['ignore', out, err],
      });
      child.on('error', fail);
      child.on('close', done);
    });
    return { code, stdout: readFileSync(stdout, 'utf8'), stderr: readFileSync(stderr, 'utf8') };
  } finally {
    closeSync(out);
    closeSync(err);
    rmSync(temp, { recursive: true, force: true });
  }
}

// Check archive checksums first
console.log('Verifying all 175 package archive checksums before publishing...');
for (const p of manifest.packages) {
  const bytes = readFileSync(join(directory, 'packages', p.file));
  if (hash(bytes) !== p.sha256 || 'sha512-' + hash(bytes, 'sha512') !== p.integrity) {
    throw new Error(`Archive checksum mismatch: ${p.name}`);
  }
}
console.log('Archive checksums verified.');

// Topological sort: dependencies before consumers
const pending = new Map(manifest.packages.map(p => [p.name, p]));
const order = [];
while (pending.size) {
  const next = [...pending.values()].find(p => Object.keys(p.dependencies).every(n => !pending.has(n)));
  if (!next) throw new Error('Dependencies form a cycle.');
  pending.delete(next.name);
  order.push(next);
}

console.log(`Publishing ${order.length} packages to GitHub Packages (npm.pkg.github.com)...`);
let count = 0;
for (const p of order) {
  count++;
  const label = `[${count}/${order.length}] ${p.name}@${p.version}`;
  const before = await npm(['view', `${p.name}@${p.version}`, 'dist.integrity', '--json']);
  if (before.code === 0) {
    const remoteIntegrity = JSON.parse(before.stdout);
    if (remoteIntegrity !== p.integrity) {
      throw new Error(`Registry version conflict for ${p.name}: registry has ${remoteIntegrity}, expected ${p.integrity}`);
    }
    console.log(`${label} - already published, integrity verified.`);
  } else {
    if (!/E404|404 Not Found/.test(before.stderr)) {
      throw new Error(`Registry check failed for ${p.name}: ${before.stderr}`);
    }
    const result = await npm(['publish', join(directory, 'packages', p.file), '--ignore-scripts', '--tag', 'candidate']);
    if (result.code !== 0) {
      throw new Error(`Publish failed for ${p.name}: ${result.stderr}`);
    }
    const after = await npm(['view', `${p.name}@${p.version}`, 'dist.integrity', '--json']);
    if (after.code !== 0 || JSON.parse(after.stdout) !== p.integrity) {
      throw new Error(`Verification after publish failed for ${p.name}: ${after.stderr}`);
    }
    console.log(`${label} - published & verified.`);
  }
}

console.log('\nAll 175 packages successfully published and verified on GitHub Packages!');
