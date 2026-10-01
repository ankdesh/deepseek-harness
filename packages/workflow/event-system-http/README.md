---
description: "Monitor approved HTTP JSON conditions and wake conversation agents without spending model requests on unchanged checks."
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system-http

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Monitor an approved HTTP JSON endpoint and wake its conversation when a selected value changes or enters an equality condition. Unchanged checks use no model requests. Debounce, traffic limits, and durable cursors bound monitoring; publication retries retain their event identity. Humans configure sources, and all resulting agent work uses the conversation's existing budget.

<a id="table-of-contents"></a>
## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service after native storage-domain and event-system services. Await `ready` before human source admission. The real Loader test composition in [phase2.spec.ts](../event-system/tests/phase2.spec.ts) demonstrates working configuration, cursor recovery, and native activation.

### Configuration

Every configuration field is required; the service supplies no hidden network defaults. The host passes exact HTTP(S) origins in `allowedOrigins`; credentials in URLs, redirects, and foreign origins are rejected.

| Field | Default | Meaning |
|---|---|---|
| `allowedOrigins` | required | Exact approved origins. |
| `tickMillis` | required | Scheduler check period. |
| `minIntervalMillis`, `maxIntervalMillis` | required | Source interval range and maximum failure backoff. |
| `timeoutMillis`, `maxResponseBytes` | required | Entire request deadline and complete response byte limit. |
| `maxSourcesPerConversation`, `maxTotalSources` | required | Retained source capacity. |
| `maxConcurrentChecks`, `maxFailures` | required | Network concurrency and failures before suspension. |

A human source definition selects `url`, a declared `eventType`, a JSON `pointer`, `condition` (`changed` or `equals`), `intervalMillis`, `debounceMillis`, and `emitInitial`. Equality also requires `expectedJson`. The host may name a bearer credential environment variable with `authorizationEnv`; persistence contains that variable name, never the secret. Missing credentials reject admission or startup. Equivalent object-key order produces the same digest. Equality fires when a value enters the condition, rather than on every matching check.

A source requires active execution for registration and publication. Pause, exhaustion, stop, and restart recovery prevent further checks. Restart requires human Resume and retains cursor and pending publication. Consecutive errors suspend the source; inspect its error and use revision-checked human re-enable after correcting the endpoint. Source controls also require its owning conversation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The version-1 `event_http_sources` domain owns immutable definitions, observed digests, debounce candidates, and a pending publication outbox. The service commits the outbox before event publication and advances its cursor only after the event-system commit. A crash between those commits reuses the source identity and sequence as a stable dedupe key. Native agent execution remains in the event-system service. Disposal aborts requests, clears the scheduler, waits for owned jobs, and closes the domain.

The optional `./invariant` companion independently checks that an acknowledged source sequence identifies a committed event. Its observer belongs to the companion fiber and is removed on disposal; re-registration installs one observer again.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Event agents](../event-system/README.md) — native execution, waits, retries, and budgets.
- [YAML definitions](../event-system-yaml/README.md) — trusted pinned reactions.
- [HTTP and waiting decision](../../../.agents/notes/implemented/architecture/2026-10-01-event-http-waiting-recovery.md) — ordering and recovery trade-offs.

-----

<a id="model-experience"></a>
## Model Experience

### Condition observations

#### What the model sees

A matching check supplies an ordinary logged event-system inbox message. Its typed payload includes `trigger_id`, `url`, `value_json`, `previous_digest`, and `current_digest`. Endpoint content is an observation, and grants no tool or mutation authority. This service adds no prompt section or model tool.

#### Token effect

HTTP requests and unchanged values consume no model tokens. A published observation and its activated agents consume the existing conversation allowance, including any configured delivery retry.

#### KV Cache effect

Pinned member instructions remain stable. The observation extends native session history, so event-specific content changes the request suffix under the native cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Monitoring has explicit deployment constraints.

- Only bounded JSON GET polling is supported; webhooks, file watchers, custom headers, and arbitrary predicates are deferred. Equality is edge-triggered and does not provide a scheduling clock. Use one process per state root. In-flight checks can finish after pause, but active-only publication rejects a wakeup while authority is absent. Source slots are retained; deleting and editing source definitions are not supplied.
- Strict allowlists and credentials are revalidated at startup. A changed deployment policy can require restoring the approved configuration before opening persisted sources. Exactly-once owner mutations remain outside the cursor/event commit boundary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Source adapters share event publication and accounting. Workflow execution and visual subscription editing remain separate decisions.

</details>
