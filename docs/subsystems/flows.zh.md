# 可复用 flows

[English](flows.md) | 中文

## 定义与执行

Flow definition 声明输入、无环图及最终结果。Flow execution 把一个不可变输入值绑定到固定的编译定义。模型选择符合条件的命名工具；executor 推进操作、分支、subflow 和受限原生模型阶段，直到声明的等待或终结结果。

| 包 | 职责 |
|---|---|
| `dsh-flow` | 公共类型、编写 helper 与纯编译 |
| `dsh-flow-runtime` | 持久命令、进度、恢复和限制 |
| `dsh-flow-yaml` | 严格定义及受目录限制的指令文件 |
| `dsh-flow-model-native` | 关联且只返回结果的原生模型阶段 |
| `dsh-tool-flow` | 命名启动工具和限定范围的进度读取 |
| `dsh-client-ui-flow` | 已提交进度及人工控制 |

## 编写

注册版本化操作，声明输入及输出 schema、读或写效果、取消行为和恢复方法。写入使用 receipt reconciliation 或人工解决。YAML 和 `defineFlow()` 使用同一编译器。`{$ref: "nodes.count.words"}` 等引用提供 JSON 值，不进行文本插值。含引用键的字面映射使用 `{$literal: ...}`。

开发者可以通过定义文件组合现有操作，无需另写模型工具 handler 或 HTTP endpoint。编译解析精确的操作和 subflow 版本，固定指令，拒绝无效引用、schema、循环、递归及过大的展开图。定义不能执行表达式。

## 持久化与控制

`flow_runs` storage domain 的版本为 1，含一个 `runs` table。每个经 schema 验证的记录保留编译定义、输入 digest、conversation ID、图帧、节点尝试、等待响应、操作 ID、限制、usage 及关联替代执行 ID。输出和决策 ID 先于后续效果提交。产品 decision outbox 保留独立事务；到 flow ledger 的投递使用稳定 ID。

执行状态为 `running`、`waiting`、`paused`、`needs-resume`、`needs-reconcile`、`succeeded`、`failed` 和 `cancelled`。节点进度与领域 approval 状态保持独立。控制携带已观察的修订号。模型可以启动和检查符合条件的 flow；人工或可信 host 命令回答等待并控制生命周期。失败执行允许显式 Cancel，以放弃剩余工作。

重启后，新模型调用或写入必须先显式 Resume。已完成节点保持完成。中断的模型工作首先检查原生 receipt。不确定写入使用原始输入及请求 ID，通过声明的恢复方法处理。Cancel 等待活动操作结束并保留已确认 service 效果。离线 trace 读取不调用模型或 service。

## 模型阶段与计费

每个阶段接收固定指令、明确数据和对象结果 schema。请求仅展示 `structured_output`，单调 guard 拒绝领域工具。成功结果需要精确的 inbox message、已提交的报告调用及已完成原生 turn。首次无效结果、缺少结果、意外工具调用或提供者错误会结束尝试。设计者输入暂停阶段，并保持普通 conversation 输入。

Flow 必须明确配置请求、token、活动时间、输出 token、保留字节数和展开节点限制。Subflow 共享配额。可信产品阶段可以把目标请求归入现有父执行预算。重启保留中断操作的保守活动时间费用。已提交的控制保留待发送记录，直到 host 确认。提供者 usage 结算预留；缺少 usage 时保留保守计费。关闭 browser 不取消进度。Headless 执行等待首次等待或终结结果，并在等待时返回执行 ID。

## 部署示例

`dsh-flow-yaml/example` plugin 注册确定性文本计数和报告操作、等值分支、共享计数 subflow 及可选原生摘要。发布的 `analyze_text` 工具使用明确的 `example` 调用上下文。它不依赖 Spec、Circuit 或 log parser。在其他部署中保持通用 flow 为可选功能。Browser remote 控制与 stdio SDK `flow/*` 方法调用相同 executor 命令。

调用回执区分已提交的分派意图与已分派的操作。重启后，Resume 可安全分派待执行意图；已分派但没有确定结果的写入使用其声明的恢复方法。每次执行记录调用方预设和模型路由，因此关闭源对话不会增加额度，也不会改变目标阶段的模型选择。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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

Types: [SessionId](core.zh.md)

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

Types: [Agent](core.zh.md)

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

Types: [Agent](core.zh.md) · [SessionId](core.zh.md)

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
