# Reusable flows

English | [中文](flows.zh.md)

## Definitions and execution

A flow definition declares inputs, an acyclic graph and its final result. A flow execution binds one immutable input value to a pinned compiled definition. The model selects an eligible named tool; the executor advances operations, branches, subflows and bounded native model phases until a declared wait or terminal result.

| Package | Responsibility |
|---|---|
| `dsh-flow` | Public types, authoring helpers and pure compilation |
| `dsh-flow-runtime` | Durable commands, progress, recovery and limits |
| `dsh-flow-yaml` | Strict definitions and contained instruction files |
| `dsh-flow-model-native` | Correlated result-only native model phases |
| `dsh-tool-flow` | Named start tools and scoped progress reads |
| `dsh-client-ui-flow` | Committed progress and human controls |

## Authoring

Register versioned operations with input and output schemas, read or write effects, cancellation behavior and recovery methods. Writes use receipt reconciliation or manual resolution. YAML and `defineFlow()` pass through the same compiler. A reference such as `{$ref: "nodes.count.words"}` supplies its JSON value; it does not interpolate text. Use `{$literal: ...}` for a literal mapping that has a reference key.

A developer can compose existing operations through a definition file without another model tool handler or HTTP endpoint. Compilation resolves exact operation and subflow versions, pins instructions and rejects invalid references, schemas, cycles, recursion and excessive expanded graphs. Definitions cannot execute expressions.

## Persistence and controls

The `flow_runs` storage domain has version 1 and one `runs` table. Each schema-validated record retains its compiled definition, input digest, conversation identities, graph frames, node attempts, wait responses, operation IDs, limits, usage and linked replacement identity. Output and decision identities commit before later effects. Product decision outboxes remain in their own transactions; delivery to the flow ledger uses stable IDs.

The execution states are `running`, `waiting`, `paused`, `needs-resume`, `needs-reconcile`, `succeeded`, `failed` and `cancelled`. Node progress and domain approval state remain separate. Controls carry an observed revision. Models can start and inspect eligible flows; human or trusted host commands answer waits and control lifecycle. A failed execution permits explicit Cancel to abandon its remaining work.

Restart requires explicit Resume before new model calls or writes. Completed nodes remain complete. Interrupted model work first checks native receipts. Uncertain writes use their declared recovery method with the original inputs and request identity. Cancel waits for active settlement and preserves confirmed service effects. Offline trace reads invoke no models or services.

## Model phases and accounting

Each phase receives pinned instructions, explicit data and an object result schema. The request presents only `structured_output`, and a monotonic guard denies domain tools. A successful result requires its exact inbox message, committed reporting call and completed native turn. The first invalid result, missing result, unexpected tool call or provider error ends the attempt. Designer input pauses it and remains ordinary conversation input.

Flows require explicit request, token, active-time, output-token, retained-byte and expanded-node limits. Subflows share these allowances. Trusted product phases can route destination requests to an existing parent execution budget. Restart retains a conservative active-time charge for interrupted dispatch. Committed controls retain pending deliveries until the host confirms them. Provider usage settles reservations; missing usage preserves a conservative charge. Browser closure does not cancel progress. Headless runs await the first wait or terminal result and return the execution identity at a wait.

## Deployment example

The `dsh-flow-yaml/example` plugin registers deterministic text counting and report operations, an equality branch, a shared counting subflow and an optional native summary. Its published `analyze_text` tool uses the explicit `example` caller context. It has no Spec, Circuit or log-parser dependency. Keep generic flows opt-in in other deployments. Browser remote controls and stdio SDK `flow/*` methods call the same executor commands.

Call receipts distinguish a committed dispatch intent from a dispatched operation. Restart can safely dispatch a pending intent after Resume; a dispatched write with no conclusive result uses its declared recovery method. Each execution captures its caller preset and model route, so closing the source conversation does not grant another allowance or change destination phase selection.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxflowcontroller--flowcontroller"></a>

### `ctx.flowController` — `FlowController`

Optional Typert consumer; transport callers cannot set execution state.

```ts cordis-catalog
/** Use the declared caller and configuration.
 * @param agent - Resolved caller.
 * @param definition - Published pinned version.
 * @param context - Eligible deployment context.
 * @param inputs - Typed arguments.
 * @param requestId - Stable caller identity.
 * @returns Accepted execution summary.
 */
@Remote('start') async start( agent: Agent, definition: FlowRef, context: string, inputs: JsonValue, requestId: string, ): Promise<FlowSummary>

/** Use the declared caller and configuration.
 * @param agent - Resolved caller.
 * @param id - Execution identity.
 * @returns Its current summary.
 */
@Remote('get') async get(agent: Agent, id: FlowExecutionId): Promise<FlowSummary>

/** Use the declared caller and configuration.
 * @param agent - Resolved caller conversation.
 * @returns Its recent execution summaries.
 */
@Remote('list') async list(agent: Agent): Promise<FlowSummary[]>

/** Use the declared caller and configuration.
 * @param agent - Resolved caller.
 * @param id - Execution.
 * @param revision - Observed revision.
 * @param command - Human command.
 * @returns Committed summary.
 */
@Remote('control') async control( agent: Agent, id: FlowExecutionId, revision: number, command: FlowControl, ): Promise<FlowSummary>

/** Use the declared caller and configuration.
 * @param agent - Resolved caller.
 * @param id - Execution.
 * @param revision - Observed revision.
 * @param waitId - Exact wait.
 * @param deliveryId - Stable response.
 * @param value - Typed response.
 * @returns Committed summary.
 */
@Remote('answer') async answer( agent: Agent, id: FlowExecutionId, revision: number, waitId: string, deliveryId: string, value: JsonValue, ): Promise<FlowSummary>

/** Use the declared caller and configuration.
 * @param agent - Resolved caller.
 * @param id - Execution.
 * @returns Offline trace, without model or service access.
 */
@Remote('trace') async trace(agent: Agent, id: FlowExecutionId): Promise<JsonValue>
```

Types: [Agent](core.md)

Source: [`packages/workflow/flow-runtime/src/controller.ts`](../../packages/workflow/flow-runtime/src/controller.ts)

<a id="ctxflows--flowruntime-abstract-seam"></a>

### `ctx.flows` — `FlowRuntime` (abstract seam)

Swappable executor; consumers never select arbitrary next states.

```ts cordis-catalog
/** Register an immutable developer definition.
 * @param definition - Developer-authored definition.
 * @returns Registration disposer.
 */
abstract registerDefinition(definition: FlowDefinition): () => void

/** Register a versioned typed operation.
 * @param operation - Registered operation.
 * @returns Registration disposer.
 */
abstract registerOperation(operation: FlowOperation): () => void

/** Register the native model phase provider.
 * @param provider - Model phase executor.
 * @returns Registration disposer.
 */
abstract registerModelProvider(provider: FlowModelProvider): () => void

/** Read definitions published for the selected caller context.
 * @param context - Caller domain context.
 * @returns Published exact definitions.
 */
abstract catalog(context: string): readonly FlowDefinition[]

/** Validate and pin a definition without external effects.
 * @param ref - Exact definition.
 * @returns Validated compiled graph.
 */
abstract compile(ref: FlowRef): CompiledFlow

/** Record an authorized execution and return acceptance.
 * @param request - Authorized invocation.
 * @returns Accepted durable execution.
 */
abstract start(request: FlowStart): Promise<FlowView>

/** Read an execution in the caller conversation.
 * @param id - Execution.
 * @param actor - Derived caller.
 * @returns Current authorized state.
 */
abstract get(id: FlowExecutionId, actor: FlowActor): FlowView

/** List recent executions in the caller conversation.
 * @param actor - Derived caller.
 * @returns Executions in the caller's conversations.
 */
abstract list(actor: FlowActor): readonly FlowView[]

/** Check whether a flow claims this conversation.
 * @param session - Participant.
 * @returns Whether a nonterminal execution claims it.
 */
abstract active(session: SessionId): boolean

/** Await a decision or terminal result.
 * @param id - Accepted execution.
 * @returns Settles at the first wait or terminal result.
 */
abstract settled(id: FlowExecutionId): Promise<FlowView>

/** Reserve actual native request bytes before provider access.
 * @param id - Execution.
 * @param operationId - Exact model attempt.
 * @param tokens - Conservative input/output capacity.
 */
abstract reserveModelEnvelope(id: FlowExecutionId, operationId: string, tokens: number): Promise<void>

/** Advance an accepted execution after its initiating turn settles.
 * @param id - Accepted execution whose initiating turn committed.
 */
abstract advance(id: FlowExecutionId): void

/** Apply a revision-checked human or trusted host control.
 * @param id - Execution.
 * @param revision - Observed revision.
 * @param command - Human command.
 * @param actor - Caller.
 * @returns Committed state.
 */
abstract control( id: FlowExecutionId, revision: number, command: FlowControl, actor: FlowActor, ): Promise<FlowView>

/** Commit the typed response to an exact pending wait.
 * @param id - Execution.
 * @param revision - Observed revision.
 * @param waitId - Exact wait.
 * @param deliveryId - Stable decision.
 * @param value - Typed decision.
 * @param actor - Caller.
 * @returns Committed state.
 */
abstract answer( id: FlowExecutionId, revision: number, waitId: string, deliveryId: string, value: JsonValue, actor: FlowActor, ): Promise<FlowView>

/** Report a correlated wait's current diagnostic without changing progress.
 * @param id - Execution.
 * @param revision - Observed revision.
 * @param waitId - Exact wait.
 * @param message - Current read failure, or undefined when resolved.
 * @param actor - Trusted caller.
 * @returns Committed view.
 */
abstract reportWaitDiagnostic( id: FlowExecutionId, revision: number, waitId: string, message: string | undefined, actor: FlowActor, ): Promise<FlowView>

/** Read an offline trace without invoking external effects.
 * @param id - Execution.
 * @param actor - Caller.
 * @returns Offline trace without invoking effects.
 */
abstract trace(id: FlowExecutionId, actor: FlowActor): FlowView
```

Types: [SessionId](core.md)

Source: [`packages/workflow/flow/src/index.ts`](../../packages/workflow/flow/src/index.ts)

<a id="ctxflowyaml--flowyamlprovider"></a>

### `ctx.flowYaml` — `FlowYamlProvider`

Loader provider; registrations unwind with its plugin fiber.

Source: [`packages/workflow/flow-yaml/src/index.ts`](../../packages/workflow/flow-yaml/src/index.ts)

<a id="flow-events"></a>

### `flow/*` events

<a id="flowcatalog-changed--emit"></a>

#### `flow/catalog-changed` — emit

Catalog contributions changed.

```ts cordis-catalog
/** Catalog contributions changed.
 * @mode emit
 */
'flow/catalog-changed'(): void
```

Source: [`packages/workflow/flow/src/index.ts`](../../packages/workflow/flow/src/index.ts)

<a id="flowchanged--parallel"></a>

#### `flow/changed` — parallel

A durable execution revision committed.

```ts cordis-catalog
/** A durable execution revision committed.
 * @param value - Committed execution.
 * @mode parallel
 */
'flow/changed'(value: FlowView): void | Promise<void>
```

Source: [`packages/workflow/flow/src/index.ts`](../../packages/workflow/flow/src/index.ts)

<a id="flowcontrol-accepted--serial"></a>

#### `flow/control-accepted` — serial

A committed control awaits trusted host delivery.

```ts cordis-catalog
/** A committed control awaits trusted host delivery.
 * @param payload - Pinned command identity and caller.
 * @mode serial
 */
'flow/control-accepted'(payload: { flow: FlowView command: FlowControl commandId: string actor: FlowActor }): void | Promise<void>
```

Source: [`packages/workflow/flow/src/index.ts`](../../packages/workflow/flow/src/index.ts)

<a id="flowmodel-input-accepted--serial"></a>

#### `flow/model-input-accepted` — serial

A native phase inbox receipt has been persisted.

```ts cordis-catalog
/** A native phase inbox receipt has been persisted.
 * @param payload - Exact execution and destination.
 * @mode serial
 */
'flow/model-input-accepted'(payload: { executionId: FlowOperationContext['executionId'] agent: Agent }): void | Promise<void>
```

Types: [Agent](core.md)

Source: [`packages/workflow/flow-model-native/src/index.ts`](../../packages/workflow/flow-model-native/src/index.ts)

<a id="flowmodel-phase--serial"></a>

#### `flow/model-phase` — serial

Bind host policies to one phase scope.

```ts cordis-catalog
/** Bind host policies to one phase scope.
 * @param payload - Exact native phase and source.
 * @mode serial
 */
'flow/model-phase'(payload: { agent: Agent executionId: FlowOperationContext['executionId'] sourceSessionId: SessionId instructions: string scope: Context }): void | Promise<void>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/workflow/flow-model-native/src/index.ts`](../../packages/workflow/flow-model-native/src/index.ts)

<a id="flowsummary-changed--emit"></a>

#### `flow/summary-changed` — emit

A cropped committed execution read.

```ts cordis-catalog
/** A cropped committed execution read.
 * @param value - Progress without private drafts.
 * @mode emit
 */
'flow/summary-changed'(value: FlowSummary): void
```

Source: [`packages/workflow/flow/src/types.ts`](../../packages/workflow/flow/src/types.ts)
<!-- END GENERATED cordis-surface -->
