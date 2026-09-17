# Product development and native distributions

English | [中文](product-distribution.zh.md)

## Summary

Develop a product against a local Harness checkout and assemble a native application release containing only its selected runtime packages. The product owns its bundles, UI, tools, configuration, dependency locks, and deployment scripts. Every product mode launches through a named `dsh` profile.

## Table of Contents

- [Development interface](#development-interface)
- [Release interface](#release-interface)
- [Maintenance](#maintenance)

<a id="development-interface"></a>

## Development interface

After the [host build](development.md), a product wrapper sets an isolated `DSH_HOME` and invokes `node scripts/product-runtime.mjs dev PRODUCT_DIRECTORY [PROFILE]` from this checkout. A single-bundle product declares `dsh.bundle.patch` in its package manifest. A layered product declares `defaultProfile` and a `profiles` object in `harness.product.json`; each profile supplies an ordered `bundles` list, product-relative `localBundles` directories, and an optional `patchReload` policy. Harness dependencies link to this checkout; product-owned dependencies must already be installed. The launcher prepares every declared profile, starts the selected or default profile, forwards termination signals, and waits for the child process to exit.

The shared profile helper updates the managed links and manifest for one named profile. It validates each local bundle, requires every local bundle in the ordered layer list, preserves an existing user patch, and refuses to replace a real directory at a managed link. Each product needs a separate state directory.

<a id="release-interface"></a>

## Release interface

A product wrapper invokes `node scripts/product-pack.mjs PRODUCT_DIRECTORY NEW_OUTPUT_DIRECTORY`. The destination must not exist. The product supplies `harness.lock.json` with `commit` and `node`, plus `harness.product.json` with `schemaVersion: 1` and a `releaseFiles` array of product-relative paths. The commit must match the checkout HEAD.

The packager preserves built launcher code and narrows only its copied dependency manifest to packages imported by the built CLI. It traverses installed dependencies, required peers, and available optional dependencies compatible with the host platform. Selected packages retain separate dependency links; a root package table also supports Cordis bare imports. Built `lib` directories remain intact because runtime exports can reference compiled files under `lib/types`.

The output includes the product package, selected runtime packages, product release files, `deployment/harness-profile.mjs`, release metadata, package license notices, file checksums, and a sibling `.tar.gz`. Internal package links stay inside the release. The target needs a supported Node runtime and any native prerequisites declared by the product. No package installation or JavaScript build runs at launch.

<a id="maintenance"></a>

## Maintenance

Keep shared runtime fixes and these tools on the fork integration branch. Product behavior stays in product repositories. Test each product against an upstream candidate before updating its Harness lock. Build and unpack a candidate release in another directory, then exercise the product through its bundled CLI. Preserve writable state outside release directories and check session-format compatibility before rollback.

The [decision record](../.agents/notes/implemented/process/2026-09-15-product-owned-native-distributions.md) explains ownership and packaging choices. `pnpm run test:product-distribution` verifies profile replacement behavior; product repositories own model/tool and relocated-release integration tests.

## Dev Note

None.
