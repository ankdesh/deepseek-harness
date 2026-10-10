# Agent Note: Reusable deterministic flows

Status: implemented

English | [中文](2026-10-09-reusable-flows.zh.md)

## Problem

A multi-operation request must survive waits, conversation changes and process loss. Model replies and browser callbacks cannot alone establish the sequence or a saved result.

## Decision

The workflow group contains reusable flow definitions, a pure compiler, durable execution, strict YAML loading, native result-only phases and generated named tools. Browser controls use the same revision-checked commands. Product operations retain semantic validation and service receipts. Existing script execution and durable workflow services remain separate and compatible. The [catalog decision](2026-09-22-configurable-prompt-and-workflow-catalogs.md) retains authority for those existing services; this capability extends execution without replacing their persisted records.

An accepted execution pins its expanded graph, instructions, immutable inputs, operation declarations and spending. Progress commits before effects. Unknown writes require their declared receipt recovery. Restart requires explicit Resume before new work. Subflows share one execution and allowance.

Native model phases use existing conversations and structured-result capture. One attempt permits one request; domain tools and automatic corrections are unavailable. A trusted host can route destination spending to an existing parent execution budget. Goal control guards prevent independent completion while required flow work remains unresolved.

Recovery records distinguish undispatched intents from uncertain effects. Native receipt inspection uses explicit persistence reads. Restored conversations remove stale phase notices before ordinary input runs. The shared request-accounting helpers retain conservative charges when usage is missing. Product service tests cover lost responses before and after submission dispatch without repeated model phases or duplicate saves, and a closed Goal source retains its pending release.

## Alternatives considered

**Text instructions or skills alone.** These can guide content authoring but do not define durable operation order or authoritative recovery.

**A model-authored plan on every request.** This adds an unbounded validation surface for common operations. Developer definitions keep compilation free of model calls and service effects.

**A central product state machine for every request.** This couples domain approval states to generic progress. Typed operations and reusable subflows keep these responsibilities separate.

## Consequences

Adding a flow over existing operations needs a definition and deployment selection, without a new endpoint or tool handler. Operation providers must retain exact version semantics and stable receipt identities. One process owns a state root; parallel execution, automatic repair, model-created definitions and portable executable traces remain deferred.

## Verification

Native Loader tests verify named tool selection, typed phase capture, interrupted Resume, SDK commands, and real JSONL/SQLite persistence. Runtime tests cover ordering, branches, subflows, correlated decisions, stale controls, conservative spending, receipt reconciliation, and durable command delivery. Headless tests verify waiting and exit identity. Product checks use a real Spec service and inspect saved source for automatic and restricted policies, architecture revision, Goal release, browser reload, browser closure, and Spec Editor approval. Full profile and documentation gates retain their observed failures; they are not release pass evidence.

Native request-reservation rejection retains its budget diagnostic and stops before provider access. A real Loader regression verifies that no model request or corrective attempt follows. Product migration also removes the legacy Python decision bridge; Spec decisions use correlated flow controls and service receipts.

Independent receipt-integrity tests detect changed model outputs while a conversation is open and after it closes. The companion reads persisted receipts in both cases; an absent native phase input is also an invariant failure.
