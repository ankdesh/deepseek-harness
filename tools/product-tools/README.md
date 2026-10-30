---
description: "Prepare named Harness profiles and assemble products from installed packages."
kind: "package-library"
---

# Product tools

English | [中文](README.zh.md)

## Summary

Prepare named product profiles and assemble products from installed Harness packages. This package has no runtime dependencies and does not require a Harness checkout.

## Profile preparation

`prepareProductProfile(product, home, options)` creates a named profile from ordered bundle metadata. Each bundle must export its package manifest and declare `dsh.bundle.patch`. The function creates managed links, preserves an existing user patch, and rejects a non-link at a managed path. Applications launch the result through `dsh --profile NAME`.

## Release assembly

`assembleProduct` checks the release-manifest checksum and installed Harness versions, then follows installed dependencies, required peers, and available optional dependencies. It copies packages into a private store and creates links within the output. It retains licence files and writes a package inventory. Private application bundles must declare `files`; assembly copies only those files, package metadata, and notices. Use a new output directory.

The caller must install from a verified production lock. Version checks alone do not authenticate installed package bytes. Clean registry verification and archive checksums belong to the release pipeline.

## Model Experience

This package does not call a model or alter prompts. It has no token or KV-cache effect. Its selected bundles determine the services available to the application.

## Known Limitations and Deferred Work

Initial distribution supports Linux x86-64 with glibc. Private bundle file lists accept positive relative patterns; exclusions and paths outside the package are rejected. Assembly requires a complete installed dependency set and does not download missing packages.
