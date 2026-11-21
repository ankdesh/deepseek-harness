# Workflow

English | [中文](workflow.zh.md)

The workflow seam lets an agent run a model-written orchestration SCRIPT that starts subagents. Like [subagent](subagent.md) it is **one optional capability**, not part of the agent loop, so its types and operations live here rather than in [core.md](core.md). Like bash, it permits ONE engine implementation per context to provide `ctx.workflowEngine`; there is no named-provider registry (a second engine replaces the first through plugin configuration rather than running beside it).

Service Definition: [dsh-workflow](../../packages/workflow/workflow) (`ctx.workflowEngine` and the vocabulary below). [dsh-workflow-ptc](../../packages/workflow/workflow-ptc) executes the VM and helpers through the shared Node PTC process runtime under the calling Session's file policy. The consumers are [dsh-tool-workflow](../../packages/workflow/tool-workflow) and the opt-in [dsh-tool-ralph](../../packages/experimental/tool-ralph). [Workflow sandbox reuse](../../.agents/notes/implemented/architecture/2026-09-13-workflow-ptc-sandbox-reuse.md) owns execution choices; the [dynamic-workflows reference](../../packages/workflow/workflow/README.md) owns script semantics.

Sources: browser-safe vocabulary in [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts), Host request and live-run handles in [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts).

## Conversation event agents

[dsh-event-system](../../packages/workflow/event-system/README.md) separately provides `ctx.eventSystems` for conversation-local native agents. `EventSystemDefinition` names a fixed primary, roster, event payload schemas, and exact subscriptions. `EventSystemSnapshot` pins that definition and its digest with members, event/delivery history, request reservations, spending, revision, and admission status (`active`, `paused`, `stopped`, `needs-resume`, `exhausted`). Events name causation within the conversation; deliveries progress from pending/dispatching to native acceptance and a completed/failed/interrupted/cancelled outcome. Retry appends a separate attempt. `ExecutionLimits` bounds admissions and aggregate model work. The [YAML provider](../../packages/workflow/event-system-yaml/README.md) resolves contained Markdown prompts; human control and model publication remain separate service consumers. These packages supply no workflow scheduler or executable graph.

`EventWait` retains member, exact event/payload response match, future event boundary, response state, and optional native goal revision. `RetryPolicy` opts a subscription into bounded replay-safe failure backoff; `Delivery.notBefore` persists its due time. [HTTP sources](../../packages/workflow/event-system-http/README.md) separately own immutable `HttpSourceInput` definitions and `HttpSourceRecord` cursor/candidate/outbox state. Observations use active-only publication and existing budgets; waiting and recovery introduce no workflow graph.

## The start request

What a caller asks for when starting a run. The ordinary workflow tool builds this from the model's `{ script, meta, args }` call plus the calling agent; specialized consumers may also select one engine-wide `subagentProvider` and lower `maxTotalAgents` for the run, but the script cannot observe or replace either policy. `meta` and `args` are plain JSON DATA (the engine validates `meta` against its schema and rejects loud BEFORE anything runs — no script text is ever evaluated to obtain it). `parent` is REQUIRED — every child the script starts is attributed to it, and cwd, lineage, and depth pass through the [subagent seam](subagent.md).

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## The workflow's identity: `WorkflowMeta`

The identity block carried as data on the start request (the tool's `meta` parameter; the field vocabulary matches the Claude Code dynamic-workflows meta block). `phases` is progress vocabulary only: `phase()` calls match titles for observers; no execution structure is implied.

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## The terminal result: `WorkflowResult`

The outcome of one run, resolved by `WorkflowRun.result`. `value` is the script's materialized return value — plain host-realm JSON data (`null` when the script returned nothing) — meaningful only for `completed`. `stopReason` is a CLOSED union (engine-owned; consumers may exhaust it): `completed` | `cancelled` | `error`. A non-`completed` reason carries the failure in `error`, and the consumer maps it to an `isError` tool result rather than reporting partial output as success.

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * The code of the fatal {@link WorkflowError} that ended an `error` run;
   * absent when the script's own exception or the engine runtime ended it.
   */
  errorCode?: WorkflowErrorCode
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (cancellation or
   * process failure) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## A live run: `WorkflowRun`

The consumer awaits `result`, may `cancel` during execution, and must `dispose` on every path. `result` never rejects: script failure resolves with `stopReason: 'error'`, and cancellation with `'cancelled'`. The PTC engine has no overall elapsed deadline; it immediately aborts the managed process when cancelled. Disposal awaits process and child cleanup under their provider contracts, without an independent workflow cleanup deadline.

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await script and child cleanup. */
  dispose(): Promise<void>
}
```

## Failure discipline: `WorkflowError.fatal`

Hook misuse inside a script — bad arguments, unknown/deferred `agent()` options, a schema outside the [structured-output subset](../../packages/core/tools/README.md), a tripped cap, a seam start failure, cancellation — throws a `WorkflowError` with `fatal: true`. The `parallel()`/`pipeline()` combinators RE-THROW fatal errors instead of mapping the item to `null`: a typo'd option must kill the script loudly, never dissolve into something that reads as an ordinary child failure. The per-item `null` is reserved for child-run failures (a non-`completed` stop reason) and ordinary in-stage script errors. When a fatal error ends a run, the engine reports its code as `WorkflowResult.errorCode`, and the `workflow` tool fails with that code, such as `AGENT_CAP`; a run that settled as `error` without one (the script's own exception or an engine runtime failure) fails with `RUN_FAILED`, and one that settled as `cancelled` with `CANCELLED`; when the calling step itself was aborted, the tool runtime's `AbortError` `ABORTED` result applies instead.

## Events

The `workflow/*` events (`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` — see the [events catalog](#cordis-surface)) are **observe-only** emits carrying DATA SNAPSHOTS: every payload starts with `WorkflowRunInfo` (id + meta), never the live `WorkflowRun`, so a subscriber cannot gain `cancel`/`dispose`, and `workflow/end` deliberately omits the result value (a listener observing outcomes must not receive a mutable alias of the caller's result). Every emit is per-listener contained — a throwing subscriber is logged, never propagated, and cannot starve the listeners registered after it — and every listener receives its own payload clone, so mutating it corrupts neither the engine nor other listeners; the containment mirrors `subagent/start`/`subagent/end`.

## Durable Chat records

The top-level `dsh-tool-workflow` consumer projects display facts into its calling parent Session without changing execution ownership. It writes `tool-workflow/run-start` after a run is accepted, pairs member start and end by `runId + seq`, and writes `tool-workflow/run-end` only after the result is known and disposal reaches quiescence. Nested transport calls write no record. The first append failure disables later writes for that run, so the log remains empty or a legal continuous prefix and the tool result is unchanged.

The record protocol allows one start per run, positive unique member sequences, paired member endings, no run ending with open members, and no updates after the run ending. A missing member ending or run ending at the log tail is valid interruption evidence rather than corruption.

`dsh-client-ui-workflow-run` folds the four events through the Conversation Node engine into one `workflow-run` Chat node anchored at the run-start sequence, after the original workflow tool node. Phase groups come only from actual member starts and preserve exact strings, including the distinction between an omitted phase and `''`. Closed Locations turn missing terminal facts into interrupted presentation. The [UI package README](../../packages/client/ui-workflow-run/README.md) owns disclosure, status, and same-parent local navigation behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxeventhttpsources--httpsourceservice"></a>

### `ctx.eventHttpSources` — `HttpSourceService`

Owns read-only network requests, cursor storage, and the publication outbox.

```ts cordis-catalog
/**
 * Read source configuration, cursors, errors, and enabled state for one conversation.
 * @param id - owning conversation.
 * @returns committed source records, with credential values excluded.
 */
list(id: SessionId): HttpSourceRecord[]

/**
 * Register one immutable human-approved source; the first unchanged observation is a baseline.
 * @param id - owning conversation; routing is pinned to its declared event subscriptions.
 * @param input - explicit URL, condition, and traffic settings.
 * @returns committed source identity and initial cursor.
 */
async add(id: SessionId, input: HttpSourceInput): Promise<HttpSourceRecord>

/**
 * Human enable/disable with the observed source revision; enabling retains cursors and outboxes.
 * @param conversationId - exact owning conversation.
 * @param id - source identity.
 * @param revision - observed source revision.
 * @param enabled - human polling authority.
 * @returns committed source state.
 */
async control( conversationId: SessionId, id: HttpSourceId, revision: number, enabled: boolean, ): Promise<HttpSourceRecord>
```

Types: [SessionId](core.md)

Source: [`packages/workflow/event-system-http/src/index.ts`](../../packages/workflow/event-system-http/src/index.ts)

<a id="ctxeventsystems--eventsystemservice"></a>

### `ctx.eventSystems` — `EventSystemService`

Owns specialists and scheduling; the primary native agent remains owned by its caller.

```ts cordis-catalog
/**
 * Register an exact trusted template; the returned disposer removes only this contribution.
 * @param input - trusted resolved definition.
 * @returns disposer for this exact registration.
 */
registerDefinition(input: EventSystemDefinition): () => void

/**
 * Resolve an exact template version; missing configuration fails before conversation execution.
 * @param id - catalog identity.
 * @param version - exact catalog version.
 * @returns registered immutable definition.
 */
definition(id: string, version: string): EventSystemDefinition

/** Prevent new catalog registrations after trusted startup composition. */
seal(): void

/**
 * Locate a member by native session identity; routing never accepts another conversation.
 * @param sessionId - native member identity.
 * @returns owning conversation and role, if configured.
 */
membership(sessionId: SessionId): EventSystemMembership | undefined

/**
 * Read committed state.
 * @param id - primary conversation identity.
 * @returns committed pinned state, if configured.
 */
get(id: SessionId): EventSystemSnapshot | undefined

/**
 * Pin a new conversation or attach to its existing configuration without rearming recovered state.
 * @param primary - caller-owned native primary agent.
 * @param mode - immutable conversation execution mode.
 * @param definition - resolved trusted roster and subscriptions.
 * @param limits - explicit aggregate resource bounds.
 * @returns existing or newly pinned conversation state.
 */
async attach( primary: Agent, mode: EventSystemSnapshot['mode'], definition: EventSystemDefinition, limits: ExecutionLimits, ): Promise<EventSystemSnapshot>

/**
 * Publish on behalf of the exact live calling member; producer and causal identity are host-owned.
 * @param agent - exact live initiator.
 * @param type - declared permitted event type.
 * @param payload - JSON payload validated against the event schema.
 * @param dedupeKey - stable producer key for the same result.
 * @returns durably committed event identity.
 */
async publishAgent(agent: Agent, type: string, payload: JsonValue, dedupeKey: string): Promise<EventId>

/**
 * Admit a trusted application/user event after payload validation and before scheduling.
 * @param id - primary conversation identity.
 * @param input - trusted validated publication request.
 * @param revision - optional exact human-observed revision.
 * @returns durably committed event identity.
 */
async publishHost(id: SessionId, input: PublishEventInput, revision?: number): Promise<EventId>

/**
 * Pause new admissions while letting the current tool result settle, for host review gates.
 * @param id - primary conversation identity.
 * @param reason - visible host review reason.
 * @returns committed state without cancelling the current tool.
 */
async hold(id: SessionId, reason: string): Promise<EventSystemSnapshot>

/**
 * Human lifecycle mutation using the exact observed revision; Resume preserves all spending.
 * @param id - primary conversation identity.
 * @param revision - exact observed revision.
 * @param action - human-authorized lifecycle change.
 * @returns committed state after scheduling or quiescence.
 */
async control(id: SessionId, revision: number, action: 'pause' | 'resume' | 'stop'): Promise<EventSystemSnapshot>

/**
 * Explicitly retry uncertain work; the caller must acknowledge possible prior effects.
 * @param id - primary conversation identity.
 * @param revision - exact observed revision.
 * @param deliveryId - failed or interrupted attempt identity.
 * @param acknowledgeUncertainty - explicit human acknowledgement of possible prior effects.
 * @returns committed state retaining the previous attempt.
 */
async retry( id: SessionId, revision: number, deliveryId: DeliveryId, acknowledgeUncertainty: boolean, ): Promise<EventSystemSnapshot>

/**
 * List persisted conversations for trusted source adapters.
 * @returns all pinned conversation snapshots.
 */
list(): EventSystemSnapshot[]

/**
 * Publish a source observation only while the owning conversation has active authority.
 * @param id - owning conversation.
 * @param input - validated source outbox item.
 * @returns durable event identity for idempotent source acknowledgement.
 */
async publishTrigger(id: SessionId, input: PublishEventInput): Promise<EventId>

/**
 * Persist a future correlated wait and disarm native goal continuation without spending rounds.
 * @param agent - exact live member executing the waiting tool.
 * @param request - declared event or host-human response request.
 * @returns committed wait with its host-generated response identity.
 */
async wait(agent: Agent, request: WaitRequest): Promise<EventWait>

/**
 * Answer one exact human wait; stale answers cannot wake another activation.
 * @param id - owning conversation.
 * @param revision - observed execution revision.
 * @param waitId - current human response identity.
 * @param answer - bounded human answer logged through the native inbox.
 * @returns durable response event identity.
 */
async answerWait(id: SessionId, revision: number, waitId: WaitId, answer: string): Promise<EventId>

/** Route a trusted host phase's spending to its existing primary conversation.
 * @param agent - Exact live phase conversation.
 * @param conversationId - Existing primary budget identity.
 * @returns Scoped registration disposer.
 */
routeRequestBudget(agent: Agent, conversationId: SessionId): () => void
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/workflow/event-system/src/index.ts`](../../packages/workflow/event-system/src/index.ts)

<a id="ctxeventsystemsyaml--eventsystemyamlprovider"></a>

### `ctx.eventSystemsYaml` — `EventSystemYamlProvider`

Register startup templates and release all registrations on disposal.

Source: [`packages/workflow/event-system-yaml/src/index.ts`](../../packages/workflow/event-system-yaml/src/index.ts)

<a id="ctxsworkflow--sworkflowservice"></a>

### `ctx.sWorkflow` — `SWorkflowService`

Sealed catalogs and state-machine owner.

```ts cordis-catalog
/**
 * Register an immutable workflow definition before sealing.
 * @param input - Value to register.
 * @param source - Origin of the registration.
 * @returns Disposer that removes this registration.
 */
registerDefinition(input: SWorkflowDefinition, source: string = 'inline'): () => void

/**
 * Register an immutable service adapter before sealing.
 * @param input - Value to register.
 * @param source - Origin of the registration.
 * @returns Disposer that removes this registration.
 */
registerAdapter(input: SWorkflowServiceAdapter, source: string = 'inline'): () => void

/**
 * Close registration for this catalog.
 */
seal(): void

/**
 * Report whether registration is closed.
 * @returns True after sealing.
 */
isSealed(): boolean

/**
 * List available workflow definitions and service adapters.
 * @param service - Optional service filter.
 * @param preset - Optional caller preset filter.
 * @returns Matching catalog entries.
 */
catalog(service?: string, preset?: SWorkflowPreset): { definitions: readonly SWorkflowCatalogEntry<SWorkflowDefinition>[] adapters: readonly SWorkflowCatalogEntry<SWorkflowServiceAdapter>[] }

/**
 * Read the current Session workflow projection.
 * @param agent - Agent that owns the Session.
 * @returns Projected workflow state.
 */
get(agent: Agent): SWorkflowProjection

/**
 * Start a run in the active Agent Session.
 * @param agent - Agent that owns the Session.
 * @param request - Definition, adapter, and limits for this run.
 * @returns Snapshot of the new run.
 */
start(agent: Agent, request: SWorkflowStartRequest): SWorkflowSnapshot

/**
 * Replace the draft in an active run.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param draft - Replacement draft value.
 * @param summary - Short description of the draft.
 * @returns Snapshot with the updated draft.
 */
updateDraft(agent: Agent, ref: SWorkflowRunRef, draft: JsonValue, summary: string): SWorkflowSnapshot

/**
 * Record step progress and resource use.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param stepId - Step that reached the checkpoint.
 * @param note - Checkpoint text.
 * @param usage - Resources to add to the recorded totals.
 * @returns Snapshot after the checkpoint.
 */
checkpoint(agent: Agent, ref: SWorkflowRunRef, stepId: string, note: string, usage: Partial<SWorkflowUsage> = {}): SWorkflowSnapshot

/**
 * Pause progress until the owner supplies input.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param prompt - Question to show the owner.
 * @returns Snapshot with the pending request.
 */
requestInput(agent: Agent, ref: SWorkflowRunRef, prompt: string): SWorkflowSnapshot

/**
 * Ask the owner to review the result.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param prompt - Question to show the owner.
 * @returns Snapshot with the pending review.
 */
requestCompletion(agent: Agent, ref: SWorkflowRunRef, prompt: string): SWorkflowSnapshot

/**
 * Supply the requested input for the run revision.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param answer - Response from the owner.
 * @returns Snapshot after accepting the answer.
 */
answerInput(agent: Agent, ref: SWorkflowRunRef, answer: string): SWorkflowSnapshot

/**
 * Approve the pending completion review.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @returns Snapshot after approval.
 */
approveCompletion(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot

/**
 * Pause the current run revision.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @returns Snapshot of the paused run.
 */
pause(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot

/**
 * Resume a paused run.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @returns Snapshot of the resumed run.
 */
resume(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot

/**
 * Cancel the current run revision.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @returns Snapshot of the cancelled run.
 */
cancel(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot

/**
 * Raise the limits for the current run revision.
 * @param agent - Agent that owns the Session.
 * @param ref - Pinned identity and, for a run, expected revision.
 * @param patch - Limits to increase.
 * @returns Snapshot with the revised limits.
 */
raiseBudgets(agent: Agent, ref: SWorkflowRunRef, patch: Partial<SWorkflowBudget>): SWorkflowSnapshot
```

Types: [Agent](core.md)

Source: [`packages/workflow/s-workflow/src/index.ts`](../../packages/workflow/s-workflow/src/index.ts)

<a id="ctxsworkflowyaml--sworkflowyamlprovider"></a>

### `ctx.sWorkflowYaml` — `SWorkflowYamlProvider`

Startup barrier proving every configured workflow document is registered.

Source: [`packages/workflow/s-workflow-yaml/src/index.ts`](../../packages/workflow/s-workflow-yaml/src/index.ts)

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, and disposal waits for script and child cleanup. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path the end is engine-synthesized with outcome `'cancelled'`.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted a narration line (a `log(message)` call).

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
