# Agent Note: HTTP observations, durable waits, and bounded recovery

Status: implemented

English | [中文](2026-10-01-event-http-waiting-recovery.zh.md)

## Problem

Conversation agents need to respond to owner changes and wait for exact external decisions without spending model requests while idle. Failure recovery must distinguish a safe repeated read from uncertain owner effects and preserve the original spending allowance.

## Decision

The [conversation event service](2026-09-30-conversation-event-agents.md) supports declared replay-safe subscription retries with durable bounded exponential backoff. Every attempt retains its own delivery and native receipt. Interrupted attempts still require explicit human uncertainty acknowledgement. Human, event, and review waits persist exact future response correlation. A primary goal wait records the blocked native goal revision; a matching response resumes only that revision with rounds remaining. Pause, stop, restart, and exhausted budgets retain admission authority.

`dsh-event-system-http` observes approved bounded JSON GET endpoints. It persists a debounce candidate and publication outbox before publishing a stable source/sequence identity. Cursor acknowledgement follows the event commit. This order permits duplicate publication after a crash, which the event ledger deduplicates, and prevents an acknowledged change from disappearing. Source configuration contains only credential environment-variable names. The invariant companion checks acknowledgement against an independently committed event and owns observer disposal.

## Alternatives considered

**Start with webhooks.** The user selected HTTP condition polling. Polling works against existing owner endpoints without adding a reachable authenticated receiver. Other sources can use the same active-only publication contract.

**Retry every failed or interrupted activation.** Rejected because an independent mutation may succeed before acknowledgement. Only a human-owned replay-safe subscription opts into automatic retries; uncertain restart work remains manual.

**Refresh budgets on a trigger or response.** Rejected because external traffic could bypass host-owned spending. All attempts and native continuation retain the pinned conversation allocation.

## Verification

Real Loader composition covers model-free unchanged checks, burst debounce, equality entry, invalid endpoints and bodies, concurrent source capacity, cursor/outbox crash recovery, native human waiting and completion, and bounded failed-delivery retries. A committed keyless native-session snapshot pins human waiting and goal continuation. Negative companion tests detect missing publications and verify disposal and re-registration. Product composition covers both presets, HTTP-driven analyst/reviewer proposal preparation, exact review-discard wakeup, owner isolation, and unchanged focused replay.

## Consequences

Polling adds bounded network traffic and detection latency. Cursor/event deduplication does not guarantee exactly-once effects in another owner's storage. Waits and events have finite capacity. Old version-1 event records load because new wait and backoff fields are optional; older binaries need not read extended records. Visual authoring and workflow execution remain outside this change.
