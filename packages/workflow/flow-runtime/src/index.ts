import { reserveRequestTokens, settleRequestTokens } from '@deepseek-ai/dsh-token-meter/request-accounting'
/** Durable serial flow executor over native storage domains. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  FlowRuntime,
  FlowInterruptedError,
  FlowModelAttemptError,
  assertFlowValue,
  compileFlow,
  defineFlow,
  defineOperation,
  flowDigest,
  flowKey,
  resolveFlowValue,
  summarizeFlow,
} from '@deepseek-ai/dsh-flow'
import type {
  CompiledFlow,
  FlowActor,
  FlowControl,
  FlowDefinition,
  FlowExecution,
  FlowExecutionId,
  FlowFrame,
  FlowLimits,
  FlowModelProvider,
  FlowNodeRecord,
  FlowOperation,
  FlowOperationContext,
  FlowRef,
  FlowStart,
  FlowView,
} from '@deepseek-ai/dsh-flow'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { flowView, transitionFlow } from './transition.ts'
export { flowView, transitionFlow } from './transition.ts'
/** Explicit deployment limits. */
export interface Config extends FlowLimits {}
export const Config: z<Config> = z.object({
  maxRequests: z.number().step(1).min(1).required(),
  maxTokens: z.number().step(1).min(1).required(),
  maxActiveMillis: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  maxRetainedBytes: z.number().step(1).min(1).required(),
  maxExpandedNodes: z.number().step(1).min(1).required(),
})
const statuses = [
  'running',
  'waiting',
  'paused',
  'needs-resume',
  'needs-reconcile',
  'succeeded',
  'failed',
  'cancelled',
] as const
const jsonSchema = zod.json()
const recordSchema = zod
  .object({
    id: zod.string().min(1),
    revision: zod.number().int().positive(),
    definition: jsonSchema,
    sourceSessionId: zod.string().min(1),
    conversations: zod.array(zod.string().min(1)).min(1),
    startKey: zod.string().min(1),
    inputs: jsonSchema,
    inputDigest: zod.string().regex(/^[a-f0-9]{64}$/),
    status: zod.enum(statuses),
    frames: zod.array(
      zod
        .object({
          path: zod.string(),
          definition: jsonSchema,
          inputs: jsonSchema,
          node: zod.string().nullable(),
          outputs: zod.record(zod.string(), jsonSchema),
          result: jsonSchema.optional(),
        })
        .strict(),
    ),
    nodes: zod.array(
      zod
        .object({
          id: zod.string().min(1),
          kind: zod.enum(['call', 'model', 'wait', 'branch', 'flow']),
          operationId: zod.string().min(1),
          attempt: zod.number().int().positive(),
          state: zod.enum(['running', 'waiting', 'succeeded', 'failed', 'unknown']),
          inputs: jsonSchema,
          startedAt: zod.number().nonnegative(),
          completedAt: zod.number().nonnegative().optional(),
          dispatchState: zod.enum(['pending', 'dispatched']).optional(),
          activeStartedAt: zod.number().nonnegative().optional(),
          activeMillis: zod.number().nonnegative().optional(),
          output: jsonSchema.optional(),
          error: zod.string().optional(),
          tokens: zod.number().nonnegative().optional(),
          usageReported: zod.boolean().optional(),
          reservedTokens: zod.number().nonnegative().optional(),
          reservationSettled: zod.boolean().optional(),
        })
        .strict(),
    ),
    pending: zod
      .object({
        id: zod.string().min(1),
        nodeId: zod.string().min(1),
        request: jsonSchema,
        schema: jsonSchema,
      })
      .strict()
      .optional(),
    result: jsonSchema.optional(),
    error: zod.string().optional(),
    limits: zod
      .object({
        maxRequests: zod.number().int().positive(),
        maxTokens: zod.number().int().positive(),
        maxActiveMillis: zod.number().int().positive(),
        maxOutputTokens: zod.number().int().positive(),
        maxRetainedBytes: zod.number().int().positive(),
        maxExpandedNodes: zod.number().int().positive(),
      })
      .strict(),
    usage: zod
      .object({
        requests: zod.number().int().nonnegative(),
        tokens: zod.number().nonnegative(),
        activeMillis: zod.number().nonnegative(),
      })
      .strict(),
    decisions: zod.record(zod.string(), jsonSchema),
    deliveries: zod
      .record(
        zod.string(),
        zod
          .object({
            command: zod.enum(['pause', 'resume', 'cancel']),
            actor: zod
              .object({ kind: zod.enum(['host', 'human', 'model']), sessionId: zod.string().min(1) })
              .strict(),
            observedRevision: zod.number().int().positive(),
            state: zod.enum(['pending', 'delivered']),
          })
          .strict(),
      )
      .optional(),
    parentExecutionId: zod.string().min(1).optional(),
    callerContext: jsonSchema.optional(),
    modelOptions: jsonSchema.optional(),
    createdAt: zod.number(),
    updatedAt: zod.number(),
  })
  .strict()
  .superRefine((value, check) => {
    try {
      const definition = value.definition as unknown as CompiledFlow
      const validateGraph = (graph: CompiledFlow): void => {
        const { digest, subflows, operations, expandedNodes, ...raw } = graph
        defineFlow(raw)
        if (flowDigest({ ...raw, subflows, operations, expandedNodes }) !== digest)
          throw new Error('Invalid compiled flow identity')
        if (
          !Number.isSafeInteger(expandedNodes) ||
          expandedNodes !==
            graph.nodes.length +
              Object.values(subflows).reduce((count, child) => count + child.expandedNodes, 0)
        )
          throw new Error('Invalid expanded definition size')
        for (const [id, child] of Object.entries(subflows)) {
          const node = graph.nodes.find(n => n.id === id)
          if (node?.kind !== 'flow' || flowKey(node.flow) !== flowKey(child))
            throw new Error('Invalid pinned subflow')
          validateGraph(child)
        }
        for (const digest of Object.values(operations))
          if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid operation declaration identity')
      }
      validateGraph(definition)
      if (
        definition.expandedNodes > value.limits.maxExpandedNodes ||
        !value.conversations.includes(value.sourceSessionId) ||
        flowDigest(value.inputs) !== value.inputDigest
      )
        throw new Error('Invalid execution references')
      assertFlowValue(definition.inputSchema, value.inputs, 'persisted inputs')
      const graphAt = (path: string): CompiledFlow => {
        let graph = definition
        for (const part of path.split('/').filter(Boolean)) {
          const child = graph.subflows[part]
          if (!child) throw new Error('Unknown frame path')
          graph = child
        }
        return graph
      }
      for (const frame of value.frames) {
        const f = frame as unknown as FlowFrame,
          graph = graphAt(f.path)
        if (
          flowDigest(f.definition) !== flowDigest(graph) ||
          (f.node !== null && !graph.nodes.some(n => n.id === f.node))
        )
          throw new Error('Invalid frame')
        assertFlowValue(graph.inputSchema, f.inputs, 'persisted frame inputs')
        for (const id of Object.keys(f.outputs))
          if (!graph.nodes.some(n => n.id === id)) throw new Error('Unknown frame output')
      }
      const attempts = new Map<string, number>()
      for (const node of value.nodes) {
        const parts = node.id.split('/'),
          local = parts.pop(),
          graph = graphAt(parts.join('/'))
        if (
          graph.nodes.find(n => n.id === local)?.kind !== node.kind ||
          node.attempt !== (attempts.get(node.id) ?? 0) + 1 ||
          node.operationId !== value.id + '/' + node.id + '/' + String(node.attempt)
        )
          throw new Error('Invalid node receipt identity')
        attempts.set(node.id, node.attempt)
      }
      for (const decision of Object.values(value.decisions)) {
        const item = decision as { digest: string; value: JsonValue }
        if (flowDigest(item.value) !== item.digest) throw new Error('Invalid decision receipt')
      }
      if (value.pending) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        const receipt = value.nodes.find(n => n.operationId === value.pending!.id)
        if (receipt?.kind !== 'wait' || receipt.id !== value.pending.nodeId || receipt.state !== 'waiting')
          throw new Error('Invalid pending wait')
      }
      if (value.status === 'waiting' && !value.pending)
        throw new Error('Waiting execution has no correlated wait')
      if (value.status === 'succeeded') {
        if (value.frames.length || value.result === undefined) throw new Error('Invalid completed execution')
        assertFlowValue(definition.outputSchema, value.result, 'persisted result')
      }
    } catch (error: unknown) {
      check.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid execution',
      })
    }
  }) as unknown as ZodType<FlowExecution>
const domainSpec = defineDomain({
  name: 'flow_runs',
  version: 1,
  tables: { runs: domainTable<FlowExecutionId, FlowExecution>(recordSchema) },
})
const terminal = (status: string): boolean => ['succeeded', 'failed', 'cancelled'].includes(status)
/** Write uncertainty is explicit; known domain validation failures stop. */
export class FlowOperationError extends Error {
  /** Mount this service in the native composition.
   * @param message - Diagnostic.
   * @param uncertain - Whether an effect may have committed.
   */
  constructor(
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message)
  }
}
/** Native provider; persistent records are the sole execution authority. */
export class DurableFlowRuntime extends FlowRuntime {
  static inject = ['storage', 'storageDomain']
  static Config = Config
  readonly ready: Promise<void>
  private table!: KvTable<FlowExecutionId, FlowExecution>
  private readonly definitions = new Map<string, FlowDefinition>()
  private readonly operations = new Map<string, FlowOperation>()
  private model: FlowModelProvider | undefined
  private readonly drivers = new Map<FlowExecutionId, { promise: Promise<void>; abort: AbortController }>()
  private queue: Promise<void> = Promise.resolve()
  private closing = false
  private readonly waiters = new Map<FlowExecutionId, Set<(view: FlowView) => void>>()
  /** Mount this service in the native composition.
   * @param ctx - Native composition.
   * @param config - Explicit limits.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    let closeDomain: (() => Promise<void>) | undefined
    this.ready = (async () => {
      const domain = await ctx.storage.domain.open(domainSpec)
      closeDomain = () => domain.close()
      this.table = domain.table('runs')
      for (const [id, record] of this.table.entries()) {
        deepFreeze(record)
        if (terminal(record.status)) continue
        const now = Date.now()
        // Loss of the process leaves dispatch duration uncertain. Retain a conservative
        // charge, bounded by the remaining allowance, before explicit Resume.
        const recovered = this.settleActive(record, now, true)
        await this.table.put(
          id,
          deepFreeze({
            ...recovered,
            status: 'needs-resume',
            revision: record.revision + 1,
            updatedAt: now,
            nodes: recovered.nodes.map(n =>
              n.state === 'running' && n.dispatchState !== 'pending'
                ? { ...n, state: 'unknown' as const }
                : n,
            ),
          }),
        )
      }
    })()
    ctx.effect(() => async () => {
      await this.ready
      this.closing = true
      for (const driver of this.drivers.values()) driver.abort.abort()
      await Promise.allSettled([...this.drivers.values()].map(d => d.promise))
      await this.queue
      await closeDomain?.()
    })
  }
  registerDefinition(definition: FlowDefinition): () => void {
    definition = defineFlow(definition)
    const key = flowKey(definition)
    if (this.definitions.has(key)) throw new Error('Duplicate flow definition ' + key)
    if (
      definition.publication &&
      [...this.definitions.values()].some(d => d.publication?.toolName === definition.publication?.toolName)
    )
      throw new Error('Duplicate published flow tool')
    this.definitions.set(key, definition)
    this.ctx.emit('flow/catalog-changed')
    return () => {
      this.definitions.delete(key)
      this.ctx.emit('flow/catalog-changed')
    }
  }
  registerOperation(operation: FlowOperation): () => void {
    operation = defineOperation(operation)
    const key = flowKey(operation)
    if (this.operations.has(key)) throw new Error('Duplicate flow operation ' + key)
    this.operations.set(key, operation)
    return () => {
      this.operations.delete(key)
    }
  }
  registerModelProvider(provider: FlowModelProvider): () => void {
    if (this.model) throw new Error('Flow model provider already registered')
    this.model = provider
    return () => {
      if (this.model === provider) this.model = undefined
    }
  }
  catalog(context: string): readonly FlowDefinition[] {
    return [...this.definitions.values()].filter(d => d.publication?.contexts.includes(context))
  }
  compile(ref: FlowRef): CompiledFlow {
    const definition = this.definitions.get(flowKey(ref))
    if (!definition) throw new Error('Unknown flow ' + flowKey(ref))
    const compiled = compileFlow(definition, this.definitions, this.operations, this.config.maxExpandedNodes)
    const checkIdentity = (candidate: CompiledFlow, saved: CompiledFlow): void => {
      if (flowKey(candidate) === flowKey(saved) && candidate.digest !== saved.digest)
        throw new Error('Flow version identity was reused with changed content')
      for (const child of Object.values(saved.subflows)) checkIdentity(candidate, child)
    }
    const checkCatalog = (candidate: CompiledFlow): void => {
      for (const [, execution] of this.table.entries()) checkIdentity(candidate, execution.definition)
      for (const child of Object.values(candidate.subflows)) checkCatalog(child)
    }
    checkCatalog(compiled)
    return compiled
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn)
    this.queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  private validatePinned(definition: CompiledFlow): void {
    for (const [key, digest] of Object.entries(definition.operations)) {
      const operation = this.operations.get(key)
      if (
        !operation ||
        flowDigest({
          id: operation.id,
          version: operation.version,
          inputSchema: operation.inputSchema,
          outputSchema: operation.outputSchema,
          effect: operation.effect,
          cancellation: operation.cancellation,
          recovery: operation.recovery,
        }) !== digest
      )
        throw new Error('Pinned operation version is unavailable or incompatible: ' + key)
    }
    for (const child of Object.values(definition.subflows)) this.validatePinned(child)
  }
  private read(id: FlowExecutionId): FlowExecution {
    const record = this.table.get(id)
    if (!record) throw new Error('Unknown flow execution')
    return record
  }
  private authorize(record: FlowExecution, actor: FlowActor, mutating = false): void {
    if (!record.conversations.includes(actor.sessionId))
      throw new Error('Flow belongs to another conversation')
    if (mutating && actor.kind === 'model') throw new Error('Flow control requires a human or trusted host')
  }
  get(id: FlowExecutionId, actor: FlowActor): FlowView {
    const record = this.read(id)
    this.authorize(record, actor)
    return flowView(record)
  }
  list(actor: FlowActor): readonly FlowView[] {
    return [...this.table.entries()]
      .map(([, r]) => r)
      .filter(r => r.conversations.includes(actor.sessionId))
      .map(flowView)
  }
  active(session: SessionId): boolean {
    return (
      Object.hasOwn(this, 'table') &&
      [...this.table.entries()].some(
        ([, r]) =>
          (!terminal(r.status) || (r.status === 'cancelled' && this.drivers.has(r.id))) &&
          r.conversations.includes(session),
      )
    )
  }
  trace(id: FlowExecutionId, actor: FlowActor): FlowView {
    return structuredClone(this.get(id, actor))
  }
  private async commit(record: FlowExecution): Promise<FlowView> {
    if (
      Buffer.byteLength(JSON.stringify(record)) + (terminal(record.status) ? 0 : 2048) >
      record.limits.maxRetainedBytes
    )
      throw new Error('Flow retained data limit exceeded')
    deepFreeze(record)
    await this.table.put(record.id, record)
    const view = flowView(record)
    await this.ctx.parallel('flow/changed', view)
    this.ctx.emit('flow/summary-changed', summarizeFlow(view))
    if (record.status !== 'running') {
      for (const waiter of this.waiters.get(record.id) ?? []) waiter(view)
      this.waiters.delete(record.id)
    }
    return view
  }
  private update(id: FlowExecutionId, change: (r: FlowExecution) => FlowExecution): Promise<FlowView> {
    return this.serial(async () => {
      const record = this.read(id),
        candidate = change(record)
      return this.commit({ ...candidate, revision: record.revision + 1, updatedAt: Date.now() })
    })
  }
  async start(request: FlowStart): Promise<FlowView> {
    await this.ready
    if (
      !request.requestId.trim() ||
      !request.context.trim() ||
      !request.actor.sessionId ||
      !['human', 'host', 'model'].includes(request.actor.kind)
    )
      throw new Error('Flow start requires a stable request ID and authorized caller context')
    const compiled = this.compile(request.definition)
    if (!compiled.publication?.contexts.includes(request.context))
      throw new Error('Flow unavailable in this context')
    assertFlowValue(compiled.inputSchema, request.inputs, 'inputs')
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    const inputs = snapshotJsonValue(request.inputs)!
    const record = await this.serial(async () => {
      const key = flowDigest([request.actor.sessionId, request.requestId]),
        digest = flowDigest(inputs)
      const old = [...this.table.entries()].find(
        ([, r]) =>
          r.sourceSessionId === request.actor.sessionId &&
          (r.startKey === key || r.startKey === request.actor.sessionId + ':' + request.requestId),
      )?.[1]
      if (old) {
        if (old.inputDigest !== digest || old.definition.digest !== compiled.digest)
          throw new Error('Start identity reused with changed inputs')
        return flowView(old)
      }
      const parent = request.parentExecutionId ? this.read(request.parentExecutionId) : undefined
      if (parent) {
        this.authorize(parent, request.actor)
        if (!terminal(parent.status)) throw new Error('Replacement requires a settled parent execution')
        if (request.parentRevision !== undefined && parent.revision !== request.parentRevision)
          throw new Error('Stale replacement source revision')
      }
      if (this.active(request.actor.sessionId)) throw new Error('Conversation already has an active flow')
      const now = Date.now(),
        id = randomUUID() as FlowExecutionId
      const native = this.ctx.get('agents')?.get(request.actor.sessionId)
      const inherited = parent?.sourceSessionId === request.actor.sessionId ? parent : undefined
      const modelOptions = native
        ? Object.fromEntries(
          ['provider', 'model', 'reasoningEffort'].flatMap((key) => {
            const captured = native.session.requestHeader()?.config
            const value =
              captured?.[key as keyof typeof captured] ?? native.options[key as keyof typeof native.options]
            return typeof value === 'string' ? [[key, value]] : []
          }),
        )
        : inherited?.modelOptions
      const priorContext = inherited?.callerContext
      const callerContext = {
        ...(priorContext && typeof priorContext === 'object' && !Array.isArray(priorContext)
          ? priorContext
          : {}),
        context: request.context,
        ...(native?.session.header.agentPreset ? { agentPreset: native.session.header.agentPreset } : {}),
        ...(native?.session.header.origin ? { origin: native.session.header.origin } : {}),
      }
      return this.commit({
        id,
        revision: 1,
        definition: compiled,
        sourceSessionId: request.actor.sessionId,
        conversations: [request.actor.sessionId],
        startKey: key,
        inputs,
        inputDigest: digest,
        status: 'running',
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        frames: [{ path: '', definition: compiled, inputs, node: compiled.nodes[0]!.id, outputs: {} }],
        nodes: [],
        ...(request.parentExecutionId ? { parentExecutionId: request.parentExecutionId } : {}),
        callerContext,
        ...(modelOptions ? { modelOptions } : {}),
        limits: {
          maxRequests: this.config.maxRequests,
          maxTokens: this.config.maxTokens,
          maxActiveMillis: this.config.maxActiveMillis,
          maxOutputTokens: this.config.maxOutputTokens,
          maxRetainedBytes: this.config.maxRetainedBytes,
          maxExpandedNodes: this.config.maxExpandedNodes,
        },
        usage: { requests: 0, tokens: 0, activeMillis: 0 },
        decisions: {},
        deliveries: {},
        createdAt: now,
        updatedAt: now,
      })
    })
    if (!request.deferred) this.advance(record.id)
    return record
  }
  async reserveModelEnvelope(id: FlowExecutionId, operationId: string, tokens: number): Promise<void> {
    await this.update(id, (r) => {
      const node = r.nodes.find(n => n.operationId === operationId)
      if (!node || node.kind !== 'model' || r.status !== 'running')
        throw new Error('Model request has no active flow attempt')
      const extra = Math.max(0, tokens - (node.reservedTokens ?? 0))
      if (r.usage.tokens + extra > r.limits.maxTokens)
        throw new Error('Native request exceeds flow token budget')
      return {
        ...r,
        usage: { ...r.usage, tokens: r.usage.tokens + extra },
        nodes: r.nodes.map(n =>
          n.operationId === operationId ? { ...n, reservedTokens: (n.reservedTokens ?? 0) + extra } : n,
        ),
      }
    })
  }
  advance(id: FlowExecutionId): void {
    if (this.closing || this.drivers.has(id) || this.read(id).status !== 'running') return
    const abort = new AbortController()
    const promise = Promise.resolve()
      .then(() => this.drive(id, abort.signal))
      .catch(async (error: unknown) => {
        if (this.read(id).status === 'running')
          await this.update(id, r => ({
            ...r,
            status: abort.signal.aborted ? 'paused' : 'failed',
            error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
          }))
      })
      .finally(() => {
        this.drivers.delete(id)
        if (!this.closing && this.read(id).status === 'running') this.advance(id)
      })
    this.drivers.set(id, { abort, promise })
  }
  async settled(id: FlowExecutionId): Promise<FlowView> {
    await this.ready
    const record = this.read(id)
    if (record.status !== 'running') return flowView(record)
    return new Promise((resolve) => {
      const waiters = this.waiters.get(id) ?? new Set()
      waiters.add(resolve)
      this.waiters.set(id, waiters)
    })
  }
  async control(
    id: FlowExecutionId,
    revision: number,
    command: FlowControl,
    actor: FlowActor,
  ): Promise<FlowView> {
    await this.ready
    await this.serial(async () => {
      const record = this.read(id)
      this.authorize(record, actor, true)
      if (command === 'resume') this.validatePinned(record.definition)
      const commandId = id + '/control/' + String(revision) + '/' + command
      if (record.deliveries?.[commandId]) return flowView(record)
      const next = transitionFlow(record, revision, command, Date.now())
      return this.commit({
        ...next,
        deliveries: {
          ...record.deliveries,
          [commandId]: { command, actor, observedRevision: revision, state: 'pending' },
        },
      })
    })
    if (command !== 'resume') {
      const driver = this.drivers.get(id)
      driver?.abort.abort()
      await driver?.promise
    }
    try {
      await this.deliverControls(id)
    } catch (error) {
      await this.update(id, r => ({
        ...r,
        status: terminal(r.status) ? r.status : 'needs-resume',
        error: String(error).slice(0, 200),
      }))
      throw error
    }
    if (command === 'resume') this.advance(id)
    return this.get(id, actor)
  }
  async answer(
    id: FlowExecutionId,
    revision: number,
    waitId: string,
    deliveryId: string,
    value: JsonValue,
    actor: FlowActor,
  ): Promise<FlowView> {
    await this.ready
    const next = await this.serial(async () => {
      const r = this.read(id)
      this.authorize(r, actor, true)
      const digest = flowDigest(value),
        old = r.decisions[deliveryId]
      if (old) {
        if (old.digest !== digest) throw new Error('Decision identity reused with changed content')
        return flowView(r)
      }
      if (r.revision !== revision || r.status !== 'waiting' || r.pending?.id !== waitId)
        throw new Error('Stale flow decision')
      assertFlowValue(r.pending.schema, value, 'decision')
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
      const frame = r.frames.at(-1)!,
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        node = frame.definition.nodes.find(n => n.id === frame.node)!
      const updated = this.finished(r, frame, node.id, value)
      const { pending: _pending, error: _error, ...cleared } = updated
      return this.commit({
        ...cleared,
        status: 'running',
        revision: r.revision + 1,
        updatedAt: Date.now(),
        decisions: { ...r.decisions, [deliveryId]: { digest, value } },
      })
    })
    this.advance(id)
    return next
  }
  async reportWaitDiagnostic(
    id: FlowExecutionId,
    revision: number,
    waitId: string,
    message: string | undefined,
    actor: FlowActor,
  ): Promise<FlowView> {
    await this.ready
    return this.serial(async () => {
      const record = this.read(id)
      this.authorize(record, actor, true)
      if (record.revision !== revision || record.status !== 'waiting' || record.pending?.id !== waitId)
        throw new Error('Stale wait diagnostic')
      const diagnostic = message?.slice(0, 200)
      if (record.error === diagnostic) return flowView(record)
      const { error: _error, ...updated } = record
      return this.commit({
        ...updated,
        ...(diagnostic ? { error: diagnostic } : {}),
        revision: record.revision + 1,
        updatedAt: Date.now(),
      })
    })
  }
  private async deliverControls(id: FlowExecutionId): Promise<void> {
    for (const [commandId, delivery] of Object.entries(this.read(id).deliveries ?? {})) {
      if (delivery.state === 'delivered') continue
      await this.ctx.serial('flow/control-accepted', {
        flow: flowView(this.read(id)),
        command: delivery.command,
        commandId,
        actor: delivery.actor,
      })
      await this.update(id, r => ({
        ...r,
        deliveries: { ...r.deliveries, [commandId]: { ...delivery, state: 'delivered' } },
      }))
    }
  }
  private settleActive(record: FlowExecution, now: number, recovered = false): FlowExecution {
    let activeMillis = record.usage.activeMillis
    const nodes = record.nodes.map((node) => {
      if (node.activeStartedAt === undefined) return node
      const elapsed = Math.max(0, now - node.activeStartedAt)
      const charged = recovered
        ? Math.min(elapsed, Math.max(0, record.limits.maxActiveMillis - activeMillis))
        : elapsed
      activeMillis += charged
      const { activeStartedAt: _started, ...settled } = node
      return { ...settled, activeMillis: (node.activeMillis ?? 0) + charged }
    })
    return { ...record, nodes, usage: { ...record.usage, activeMillis } }
  }
  private finished(r: FlowExecution, frame: FlowFrame, nodeId: string, output: JsonValue): FlowExecution {
    const i = frame.definition.nodes.findIndex(n => n.id === nodeId),
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
      node = frame.definition.nodes[i]!
    const next = node.next === undefined ? (frame.definition.nodes[i + 1]?.id ?? null) : node.next
    const path = frame.path + nodeId
    const outputs = { ...frame.outputs, [nodeId]: output }
    const attempt = r.nodes.findLast(n => n.id === path)?.operationId
    return {
      ...r,
      frames: [
        ...r.frames.slice(0, -1),
        {
          ...frame,
          node: next,
          outputs,
          ...(next === null && node.result !== undefined
            ? { result: resolveFlowValue(node.result, frame.inputs, outputs) }
            : {}),
        },
      ],
      nodes: r.nodes.map(n =>
        n.operationId === attempt && ['running', 'unknown', 'waiting'].includes(n.state)
          ? { ...n, output, state: 'succeeded', completedAt: Date.now() }
          : n,
      ),
    }
  }
  private context(id: FlowExecutionId, receipt: FlowNodeRecord, signal: AbortSignal): FlowOperationContext {
    return {
      executionId: id,
      nodeId: receipt.id,
      operationId: receipt.operationId,
      sourceSessionId: this.read(id).sourceSessionId,
      signal,
      claimConversation: async (sessionId) => {
        await this.update(id, (r) => {
          if (
            [...this.table.entries()].some(
              ([key, other]) =>
                key !== id &&
                (!terminal(other.status) || (other.status === 'cancelled' && this.drivers.has(key))) &&
                other.conversations.includes(sessionId),
            )
          )
            throw new Error('Destination conversation already has an active flow')
          return { ...r, conversations: [...new Set([...r.conversations, sessionId])] }
        })
      },
    }
  }
  private async drive(id: FlowExecutionId, signal: AbortSignal): Promise<void> {
    await this.deliverControls(id)
    while (!signal.aborted && !this.closing && this.read(id).status === 'running') {
      const r = this.read(id),
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        frame = r.frames.at(-1)!
      if (frame.node === null) {
        const output = Object.hasOwn(frame, 'result')
          ? // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
          frame.result!
          : resolveFlowValue(frame.definition.outputs, frame.inputs, frame.outputs)
        assertFlowValue(frame.definition.outputSchema, output, 'result')
        await this.update(id, (current) => {
          if (current.status !== 'running') return current
          if (current.frames.length === 1) {
            const { error: _error, ...completed } = current
            return { ...completed, status: 'succeeded', result: output, frames: [] }
          }
          // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
          const parent = current.frames.at(-2)!
          return this.finished(
            { ...current, frames: current.frames.slice(0, -1) },
            parent,
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            parent.node!,
            output,
          )
        })
        continue
      }
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
      const node = frame.definition.nodes.find(n => n.id === frame.node)!,
        path = frame.path + node.id
      if (node.kind === 'branch') {
        const value = resolveFlowValue(node.value, frame.inputs, frame.outputs)
        const condition = flowDigest(value) === flowDigest(node.equals)
        const next = condition ? node.then : node.otherwise,
          outputs = { ...frame.outputs, [node.id]: condition }
        await this.update(id, current => ({
          ...current,
          nodes: [
            ...current.nodes,
            {
              id: path,
              kind: 'branch',
              operationId: id + '/' + path + '/1',
              attempt: 1,
              state: 'succeeded',
              inputs: { value, equals: node.equals },
              output: condition,
              startedAt: Date.now(),
              completedAt: Date.now(),
            },
          ],
          frames: [
            ...current.frames.slice(0, -1),
            {
              ...frame,
              node: next,
              outputs,
              ...(next === null && node.result !== undefined
                ? { result: resolveFlowValue(node.result, frame.inputs, outputs) }
                : {}),
            },
          ],
        }))
        continue
      }
      const inputs = resolveFlowValue(
        node.kind === 'wait' ? node.request : node.inputs,
        frame.inputs,
        frame.outputs,
      )
      let receipt = r.nodes.findLast(n => n.id === path)
      if (!receipt || receipt.state === 'failed') {
        receipt = {
          id: path,
          kind: node.kind,
          operationId: id + '/' + path + '/' + String((receipt?.attempt ?? 0) + 1),
          attempt: (receipt?.attempt ?? 0) + 1,
          state: 'running',
          inputs,
          startedAt: Date.now(),
          ...(node.kind === 'call' ? { dispatchState: 'pending' as const } : {}),
        }
        const saved = receipt
        await this.update(id, current => ({ ...current, nodes: [...current.nodes, saved] }))
      }
      let context = this.context(id, receipt, signal)
      if (node.kind === 'flow') {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        const definition = frame.definition.subflows[node.id]!
        assertFlowValue(definition.inputSchema, inputs, 'subflow inputs')
        await this.update(id, current => ({
          ...current,
          frames: [
            ...current.frames,
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            { path: path + '/', definition, inputs, node: definition.nodes[0]!.id, outputs: {} },
          ],
        }))
        continue
      }
      if (node.kind === 'wait') {
        await this.update(id, current => ({
          ...current,
          status: 'waiting',
          nodes: current.nodes.map(n =>
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            n.operationId === receipt!.operationId ? { ...n, state: 'waiting' } : n,
          ),
          // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
          pending: { id: receipt!.operationId, nodeId: path, request: inputs, schema: node.outputSchema },
        }))
        return
      }
      await this.update(id, (current) => {
        if (current.status !== 'running')
          throw new FlowInterruptedError('Flow paused before operation dispatch')
        return {
          ...current,
          nodes: current.nodes.map(n =>
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            n.operationId === receipt!.operationId ? { ...n, activeStartedAt: Date.now() } : n,
          ),
        }
      })
      const remaining = Math.max(1, r.limits.maxActiveMillis - r.usage.activeMillis)
      const deadline = AbortSignal.timeout(remaining)
      context = { ...context, signal: AbortSignal.any([signal, deadline]) }
      try {
        let output: JsonValue
        if (node.kind === 'call') {
          const op = this.operations.get(flowKey(node.operation))
          if (!op) throw new Error('Operation provider unavailable')
          assertFlowValue(op.inputSchema, inputs, 'operation inputs')
          const pinned = frame.definition.operations[flowKey(node.operation)]
          if (
            pinned !==
            flowDigest({
              id: op.id,
              version: op.version,
              inputSchema: op.inputSchema,
              outputSchema: op.outputSchema,
              effect: op.effect,
              cancellation: op.cancellation,
              recovery: op.recovery,
            })
          )
            throw new Error('Operation version changed')
          let restored: unknown
          if (receipt.state === 'unknown') {
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            if (op.recovery === 'receipt') restored = await op.reconcile!(inputs, context)
            else if (op.recovery === 'manual') {
              restored = await op.reconcile?.(inputs, context)
              if (restored === undefined) {
                await this.update(id, current => ({
                  ...this.settleActive(current, Date.now()),
                  status: 'needs-reconcile',
                  error: 'Operation requires manual reconciliation',
                }))
                return
              }
            }
            if (op.recovery === 'receipt' && restored === undefined) {
              await this.update(id, current => ({
                ...this.settleActive(current, Date.now()),
                status: 'needs-reconcile',
                error: 'No conclusive service receipt',
              }))
              return
            }
          }
          output = snapshotJsonValue(
            restored === undefined
              ? await (async () => {
                if (this.read(id).usage.activeMillis >= r.limits.maxActiveMillis)
                  throw new FlowOperationError('Flow active time exhausted', false)
                context.signal.throwIfAborted()
                await this.update(id, (current) => {
                  if (current.status !== 'running')
                    throw new FlowInterruptedError('Flow paused before operation dispatch')
                  return {
                    ...current,
                    nodes: current.nodes.map(n =>
                    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
                      n.operationId === receipt!.operationId ? { ...n, dispatchState: 'dispatched' } : n,
                    ),
                  }
                })
                context.signal.throwIfAborted()
                return op.execute(inputs, context)
              })()
              : restored,
          ) as JsonValue
          assertFlowValue(op.outputSchema, output, 'operation output')
        } else {
          if (!this.model) throw new Error('Native flow model provider unavailable')
          const conversation = (
            node.conversation
              ? resolveFlowValue(node.conversation, frame.inputs, frame.outputs)
              : r.sourceSessionId
          ) as SessionId
          if (typeof conversation !== 'string' || !conversation)
            throw new Error('Model conversation is invalid')
          await context.claimConversation(conversation)
          const restored =
            receipt.state === 'unknown'
              ? await this.model.reconcile?.(node, conversation, context)
              : undefined
          let result = restored
          let reserved = 0
          if (!result) {
            if (receipt.state === 'unknown') {
              await this.update(id, current => this.settleActive(current, Date.now()))
              receipt = {
                id: path,
                kind: node.kind,
                operationId: id + '/' + path + '/' + String(receipt.attempt + 1),
                attempt: receipt.attempt + 1,
                state: 'running',
                inputs,
                startedAt: Date.now(),
                activeStartedAt: Date.now(),
              }
              const attempt = receipt
              await this.update(id, current => ({ ...current, nodes: [...current.nodes, attempt] }))
              context = this.context(id, receipt, AbortSignal.any([signal, deadline]))
            }
            reserved = reserveRequestTokens(
              { instructions: node.instructions, inputs, schema: node.outputSchema },
              r.limits.maxOutputTokens,
            )
            await this.update(id, (current) => {
              if (
                current.usage.requests >= current.limits.maxRequests ||
                current.usage.tokens + reserved > current.limits.maxTokens ||
                current.usage.activeMillis >= current.limits.maxActiveMillis
              )
                throw new Error('Flow model budget exhausted')
              return {
                ...current,
                usage: {
                  ...current.usage,
                  requests: current.usage.requests + 1,
                  tokens: current.usage.tokens + reserved,
                },
                nodes: current.nodes.map(n =>
                  // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
                  n.operationId === receipt!.operationId ? { ...n, reservedTokens: reserved } : n,
                ),
              }
            })
            const remaining = this.read(id).limits.maxActiveMillis - this.read(id).usage.activeMillis
            const timeout = AbortSignal.timeout(remaining)
            result = await this.model.execute(
              node,
              inputs,
              conversation,
              { ...context, signal: AbortSignal.any([signal, timeout]) },
              r.limits,
            )
          }
          output = result.value
          await this.update(id, (current) => {
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            const nodeReceipt = current.nodes.find(n => n.operationId === receipt!.operationId)!
            if (nodeReceipt.reservationSettled) return current
            return {
              ...current,
              usage: {
                ...current.usage,
                tokens:
                  current.usage.tokens -
                  (nodeReceipt.reservedTokens ?? 0) +
                  settleRequestTokens(nodeReceipt.reservedTokens ?? 0, result.tokens),
              },
              nodes: current.nodes.map(n =>
                // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
                n.operationId === receipt!.operationId
                  ? {
                    ...n,
                    reservationSettled: true,
                    tokens: settleRequestTokens(nodeReceipt.reservedTokens ?? 0, result.tokens),
                    usageReported: result.tokens !== undefined,
                  }
                  : n,
              ),
            }
          })
          assertFlowValue(node.outputSchema, output, 'model output')
        }
        await this.update(id, (current) => {
          const completed = this.finished(
            this.settleActive(current, Date.now()),
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            current.frames.at(-1)!,
            node.id,
            output,
          )
          return deadline.aborted && current.status === 'running'
            ? { ...completed, status: 'failed', error: 'Flow active time exhausted' }
            : completed
        })
      } catch (error: unknown) {
        const timedOut = deadline.aborted && !signal.aborted
        const uncertain =
          node.kind === 'call' &&
          (error instanceof FlowOperationError
            ? error.uncertain
            : this.operations.get(flowKey(node.operation))?.effect === 'write')
        const message = (
          timedOut ? 'Flow active time exhausted' : error instanceof Error ? error.message : String(error)
        ).slice(0, 200)
        if (error instanceof FlowModelAttemptError && error.tokens !== undefined)
          await this.update(id, (current) => {
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            const attempt = current.nodes.find(n => n.operationId === receipt!.operationId)!
            if (attempt.reservationSettled || attempt.reservedTokens === undefined) return current
            return {
              ...current,
              usage: {
                ...current.usage,
                tokens:
                  current.usage.tokens -
                  attempt.reservedTokens +
                  settleRequestTokens(attempt.reservedTokens, error.tokens),
              },
              nodes: current.nodes.map(n =>
                // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
                n.operationId === receipt!.operationId
                  ? {
                    ...n,
                    reservationSettled: true,
                    tokens: settleRequestTokens(attempt.reservedTokens ?? 0, error.tokens),
                    usageReported: true,
                  }
                  : n,
              ),
            }
          })
        await this.update(id, current => ({
          ...this.settleActive(current, Date.now()),
          status: terminal(current.status)
            ? current.status
            : signal.aborted || error instanceof FlowInterruptedError
              ? 'paused'
              : uncertain
                ? 'needs-reconcile'
                : 'failed',
          error: message,
          nodes: this.settleActive(current, Date.now()).nodes.map(n =>
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
            n.operationId === receipt!.operationId
              ? {
                ...n,
                state:
                    n.dispatchState === 'pending' && (signal.aborted || error instanceof FlowInterruptedError)
                      ? 'running'
                      : uncertain || signal.aborted || error instanceof FlowInterruptedError
                        ? 'unknown'
                        : 'failed',
                error: message,
              }
              : n,
          ),
        }))
        return
      }
    }
  }
}
export default DurableFlowRuntime

export { FlowController } from './controller.ts'
