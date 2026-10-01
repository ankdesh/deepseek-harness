# Agent Note: Persistent conversation event agents

Status: implemented

English | [中文](2026-09-30-conversation-event-agents.zh.md)

## Problem

A product's repeated analysis/review requests need persistent specialist memory and host-owned spending. One-shot delegation resets identity, and model-reported workflow checkpoints do not observe every native request. Goals also need bounded native continuation without depending on an executable workflow definition.

## Decision

`dsh-event-system` and `dsh-event-system-yaml` provide a generic conversation event service and strict YAML/Markdown loading. They persist typed publications with their fixed subscription deliveries, reuse native sessions, observe native receipts and turn endings separately, and meter initiator-owned requests before provider access. Product adapters keep immutable owner binding and proposal/review authority. Human pause/resume/stop and acknowledged retry operate on observed revisions. Restart requires explicit human Resume; uncertain deliveries are never automatically replayed.

The existing [prompt and workflow catalog decision](../../implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) remains active because its generic services and historical Session decoding still exist. This decision replaces the product's orchestration composition, not those independent package APIs. The native [event-sourced Session decision](../../implemented/architecture/2026-06-11-event-sourced-sessions.md) remains authoritative for model-visible input; event deliveries enter the ordinary logged inbox.

## Alternatives considered

**Implement workflows in the first release.** The user deferred workflow setup. Fixed event subscriptions meet the immediate collaboration need without graph scheduling, joins, or a second model loop.

**Keep the prototype product-local.** Rejected because agent identity, receipts, admission, and resource ownership are reusable native execution concerns. Products still own semantic tools and owner mutations.

**Automatically replay interrupted work.** Rejected because independent owner side effects may have succeeded before their acknowledgement persisted. Human acknowledgement creates a separate bounded attempt and preserves history.

## Verification

Real Loader composition executes the generic example and native goal continuation with persistent sessions, bounded accounting, pause/stop, and human restart recovery. Product composition covers owner proposal preparation for both presets, specialist read-only capabilities, unchanged focused behavior, and review status. Parser, integrity, failure, and cancellation regressions reject invalid admissions. Source setup links compile-time dependencies and tooling to the same fork used by the native runtime. Targeted Harness tests and product integration tests pass; release publication and pin advancement remain separate.

## Consequences

Independent native logs, the delivery ledger, and owner storage cannot guarantee exactly-once mutation. Conservative token reservations may reject expensive contexts early. Event history is finite. External triggers, automated retry, general durable waiting, configuration editing, and workflows remain outside this phase.

The [HTTP/waiting recovery decision](2026-10-01-event-http-waiting-recovery.md) adds the separately bounded Phase 2 capabilities; the original identity, accounting, and uncertain-effect rules remain in force.
