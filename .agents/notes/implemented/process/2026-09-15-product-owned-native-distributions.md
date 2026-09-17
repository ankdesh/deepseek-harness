# Agent Note: Product-owned native distributions

Status: implemented

English | [中文](2026-09-15-product-owned-native-distributions.zh.md)

## Problem

Independent applications need local Harness changes during development and a small deployable runtime. A stock CLI dependency installation brings unrelated product bundles; a separate product agent loop duplicates Harness lifecycle ownership.

## Decision

The fork owns generic development linking, named profile preparation, and native dependency assembly. Each product owns its ordered profile bundles and deployment recipe. A recipe may declare several profiles over the same product package graph, including distinct browser and one-shot modes. Every mode launches the ordinary dsh CLI. Development launch forwards profile arguments and may select an existing run directory through `DSH_PRODUCT_RUN_CWD`, so one-shot products retain the stock CLI grammar while choosing a product-owned workspace. The packager copies built CLI code unchanged and derives its deployment dependency list from the built module imports.

The package graph retains local dependency links and exposes selected packages at the installation root for Cordis imports. Names owned by the pinned Harness checkout resolve from that checkout before product-installed registry packages, which keeps the CLI and its runtime packages on one source generation. The packager preserves complete built lib directories, including runtime-referenced compiled files in lib/types. It rejects a mismatched Harness commit or an existing output directory. Release metadata records the source commit, dirty state, lock hash, packager hash, platform, and package roster.

## Alternatives considered

**Install the full stock CLI and disable plugins.** Disabled plugins retain their installed dependencies. Selecting the deployed package graph removes unrelated packages.

**Copy an agent loop into each product.** Separate loops duplicate runtime behavior and complicate upstream updates. Product plugins compose the existing loop instead.

**Maintain a platform repository in addition to the fork.** The generic tooling is small and depends on Harness artifact conventions, so the fork is its current owner.

## Consequences

Products share build mechanics while retaining independent runtime configuration and state. A product may install published Harness packages for manifest completeness without allowing those copies to split the assembled runtime from the pinned checkout. Native releases target the build platform and require separately provisioned platform runtimes. The product owns end-to-end execution, persistence, UI, and relocation tests; profile filesystem tests live beside the shared helper.

See [product distribution](../../../../docs/product-distribution.md) for the implemented interfaces.
