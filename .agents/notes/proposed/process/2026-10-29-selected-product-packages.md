# Agent Note: Selected product package releases

Status: proposed

English | [中文](2026-10-29-selected-product-packages.zh.md)
## Problem

Source-linked applications depend on a complete Harness checkout. Broad launcher and UI bundles also install features that an application does not enable. A short direct dependency list does not measure the resulting installation.

## Proposal

Publish selected built packages under the downstream account scope through GitHub Packages. Preserve the normal profile launcher. Extract web startup from UI selection and provide repository-independent profile preparation and assembly. Keep the existing model adapter. Consumer manifests declare their services and UI modules explicitly.

Release archives carry exact versions, source and consumer commits, checksums, and per-profile inventories. Verify the same archives through a temporary registry and realistic consumer roots. Run the required consumer acceptance profiles against the candidate installation. Publication checks complete evidence, publishes those bytes, verifies registry integrity, and creates promotion metadata only after every package is available.

## Alternatives considered

Repairing declarations alone retains broad bundles. A single compiled application package reduces visible package names but complicates native files, dynamic modules, debugging, and independent application selection. Keeping separate modules allows later products to select other capabilities.

## Acceptance criteria

Clean web and headless consumers install, build, and start without a Harness checkout. Headless contains no browser UI packages. Features and historical records retain their required behavior. Complete installed-set measurements include third-party packages. Missing credentials, failed checks, dirty inputs, and partial publication prevent promotion. Source links remain an explicit development mode.

## Risks

The retained model adapter still contributes substantial third-party code. Scope rewriting must cover built imports, types, configuration, and native payload references. Required live model checks need CI credentials. Existing application regressions can block a release even when installation succeeds. Public distribution and additional platforms need separate review and tests.
