---
description: "Persistent conversation event agents, durable deliveries, and aggregate host budgets."
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system

English | [中文](README.zh.md)

## Summary

Use this service for fixed, conversation-local reactions between persistent native agents. A committed typed event creates subscription deliveries; native inbox messages activate the configured members. The host owns configuration, resource limits, and human controls. Idle members do not request models. Native goal continuation can use the same accounting without routing its rounds through subscriptions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Compose native agents, session persistence, tools, system prompts, token metering, and a storage-domain backend before this service. Load exact trusted templates with the [YAML provider](../event-system-yaml/README.md), await `ready`, and seal the catalog. The host attaches a primary agent with a definition, mode, and explicit `ExecutionLimits`; subsequent attachment retains its pinned definition and spending. Configured tools must be supplied by the member's native composition. The executor rejects tools outside its allowlist.

The [analysis/review template](examples/analysis-review/system.yml) and adjacent Markdown prompts are a generic example with no product imports. Unspecified member provider/model choices inherit the primary's selected route at attachment; the resolved choices remain pinned unless a new conversation is created. The Loader composition regression executes this example using a scripted provider; its native sessions, tools, goals, persistence, storage, and dispatcher remain real. Run `pnpm exec vitest run packages/workflow/event-system/tests packages/workflow/event-system-yaml/tests` from the repository root.

`publishHost` admits validated application events; `publishAgent` derives the live caller and causation and checks its publication permissions. Producers use stable deduplication keys. Reusing a key with changed content fails. Matching is exact event type to a fixed target member; targets never come from model arguments.

`control` performs revision-checked pause/resume/stop. Pause and stop cancel active native agents and await quiescence. Stop is terminal. Resume preserves resource usage and cannot override exhaustion. Recovery marks active systems `needs-resume` and uncertain dispatches `interrupted`; it never invokes a model automatically. `retry` requires the observed revision, active state, and explicit uncertainty acknowledgement. It appends a new delivery attempt while retaining the prior receipt and error. Each subscription's attempt chain is bounded by `maxRequests`; pending work remains bounded by `maxPending`.

## Understand the implementation

The storage domain `event_systems`, version 1, owns one pinned snapshot per primary Session ID. Event and delivery IDs, native message IDs, activation IDs, and request reservations are separate identities. Each event and its complete subscription fan-out commit in one serialized table update. Acceptance follows the exact native `user/message` receipt; completion follows that agent's matching `turn/end`. A receipt is not successful completion. Restart validates the definition digest, membership, delivery references, and acyclic in-conversation causation before allowing human Resume.

Limits bound members, concurrent delivery activations, rounds, requests, token spending, active model time, pending deliveries, event history, complete event bytes, causal depth, and output tokens. Every initiator-owned `llm/stream` call is reserved before provider access, including native retry and compaction calls. Direct calls require an explicit output cap at or below `maxOutputTokens`. Token reservation uses the larger of serialized request bytes and native token-meter estimation plus output capacity; disjoint reported usage settles the reservation. Missing usage and interrupted requests retain conservative reservations. Shared timers account overlapping active model requests and cancel all members at the time limit. Neither new events nor process reload grants fresh resources.

The caller owns the primary Agent handle. The service owns specialist handles, dispatcher jobs, timers, and its domain handle; disposal cancels work, waits for jobs and agents, releases specialists, and closes the domain. The optional `./invariant` companion checks committed delivery transitions against independently observed native message and turn receipts. No new Session event types or loop changes are introduced.

## Further Exploration

- [YAML provider](../event-system-yaml/README.md) — trusted text loading and prompt containment.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the group's separately composed execution capabilities.
- [Decision](../../../.agents/notes/implemented/architecture/2026-09-30-conversation-event-agents.md) — ownership and deferred features.

## Model Experience

### Pinned member instructions

#### What the model sees

Each member receives its trusted resolved Markdown in a stable system-prompt section. The generic example's primary instruction is reproduced below; deployed definitions may supply different text.

##### Generic primary instruction

```markdown
Acknowledge direct requests. Wait for the analyst and reviewer events, then summarize the reviewer result. Read get_event_system to inspect the configured reactions.
```

#### Token effect

The pinned instruction adds one section per member. Delivered events and tool results add native history; no model request occurs merely because a member is idle.

#### KV Cache effect

Pinned instruction text stays stable across activations. Native history extends the existing prefix; this service adds no custom cache protocol.

### Event publications and deliveries

#### What the model sees

`publish_event` validates `payload_json` and returns a durable event identity; `get_event_system` returns the member, configured event schemas, limits, and deliveries. Inbox input is a logged plugin message containing `event`, `activation_id`, and `subscription`. Host tool presentation uses the ordinary text result.

#### Token effect

The event envelope and inspected delivery history consume input tokens. Every initiating request reserves conservative input/output capacity before provider access.

#### KV Cache effect

Event-specific input changes the suffix while leaving pinned instructions unchanged. Request construction and native compaction retain their existing cache behavior.

## Known Limitations and Deferred Work

- No workflow executor, graph joins, external monitors, automatic retry/backoff, cross-conversation routing, general durable waiting, configuration editor, or budget top-up is supplied. Event history is bounded and fails admission at its configured limit. Human retry acknowledges possible prior effects; exactly-once side effects across independent storage and owner systems are not claimed. Conservative byte reservations can exhaust a token allowance before a provider would. Use one process per persisted state root.

### Dev Note

The generic service owns scheduling and accounting; product adapters retain owner binding, proposal tools, approval checks, and review UI. The primary can receive ordinary native human input while specialists run; subscription dispatch counts running members against concurrency, and all their model spending shares one allowance.
