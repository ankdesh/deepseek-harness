# Agent Note: ankdesh-dsh fork maintenance

Status: implemented

English | [中文](2026-11-21-ankdesh-fork-maintenance.zh.md)

## Problem

The fork, upstream, and the first consumer can change on different schedules. Both coding agents need the same standing rules.

## Decision

The [fork constitution](../../../ankdesh/constitution.md) gives both agents the same rules and keeps fork policy in a directory owned by the fork. The root instruction file carries one link. The [release procedure](../../../ankdesh/release.md) keeps tested archives and publication evidence in a private repository.

The framework recipe owns the published package roots. The pinned spec2gds application checks the selected packages through its named profiles. An application dependency outside the selected package set fails candidate verification. The candidate registry reads metadata from the archive so renamed packages can be verified without the staging directory.

## Alternatives considered

A separate source workspace would require a second build and a compatibility check across repositories. The fork keeps one workspace and uses the published packages as the product interface.

## Consequences

Review these upstream edits when changing the base:

- Session registration recognizes fork event types. The event-system ledger and flow runtime tests exercise recovery and replay.
- SDK protocol and server changes carry workflow state. The SDK server tests exercise the RPC behavior.
- Web startup serves the selected runtime with a product-owned UI. The web-app startup test and the assembled web profile check cover startup.
- Structured subagent output allows parallel calls to the same tool. The structured driver tests cover the output contract. Add a focused check if a sync changes parallel handling.

## First upstream sync

The sync merges `2e39e70496` and uses a fresh DSH_HOME. The old release owns its V3
data. See the [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.5/ankdesh-fresh-state/guide.md).

- The event-system and native Flow model use V4 producer sources. The native
  Flow model reads dedicated tool-role result records. The Flow and event
  runtime tests cover review, wait, resume, and replay.
- The unified subagent capture helper accepts duplicate parallel output calls.
  The first valid result remains authoritative. The structured output test
  covers the duplicate calls.
- The web runtime bundle owns the startup policy. The workspace fallbacks
  still use one new-Session handler. Deployment policy can constrain the
  locale list and hide the locale selector without removing the saved
  preference. The web startup and Client tests cover these paths.
- The browser Flow controls use the regular remote contract. The LiveShare
  policy classifies all six endpoints as owner-only.
- The upstream settings and agent preset packages changed names. The
  unarchive settings entry moved into General settings. Product profiles
  must use the current packages and mount the selected tool executor.
