/**
 * Startup-sealed workflow and service-adapter catalogs plus a durable,
 * human-governed workflow state machine.
 * @module @deepseek-ai/dsh-s-workflow
 */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type {
  SWorkflowBudget,
  SWorkflowPreset,
  SWorkflowProjection,
  SWorkflowProjectionState,
  SWorkflowResolvedRef,
  SWorkflowRef,
  SWorkflowRunRef,
  SWorkflowSnapshot,
  SWorkflowStatus,
  SWorkflowUsage,
} from './types.ts'

export type * from './types.ts'

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/
const ACTIVE: readonly SWorkflowStatus[] = [
  'active', 'pause-pending', 'paused', 'awaiting-user-input',
  'awaiting-user-completion', 'blocked',
]

/** One declarative, deployment-owned workflow. */
export interface SWorkflowDefinition {
  readonly apiVersion: 'dsh.deepseek.ai/v1'
  readonly kind: 'WorkflowDefinition'
  readonly metadata: SWorkflowRef
  readonly service: string
  readonly presets: readonly SWorkflowPreset[]
  readonly steps: readonly {
    readonly id: string
    readonly kind: 'model' | 'review' | 'delegation' | 'checkpoint'
    readonly description: string
  }[]
}

/** One exact service-specific contribution set. */
export interface SWorkflowServiceAdapter {
  readonly apiVersion: 'dsh.deepseek.ai/v1'
  readonly kind: 'ServiceAdapter'
  readonly metadata: { readonly id: string; readonly version: string }
  readonly service: string
  readonly promptBundles: readonly SWorkflowRef[]
  readonly toolPackages: readonly string[]
  readonly skillPackages: readonly string[]
  readonly reviewKind: string
}

/** Catalog entry with canonical content digest. */
export interface SWorkflowCatalogEntry<T> {
  readonly value: T
  readonly digest: `sha256:${string}`
  readonly source: string
}

/** Full durable event; omission changes reconstruction and is not ignorable. */
export interface SWorkflowChange {
  readonly kind: 's-workflow/change'
  readonly version: 1
  readonly operation: string
  readonly workflow: SWorkflowSnapshot
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete post-mutation workflow state. The snapshot records the exact
     * definition and service-adapter content identities, lifecycle phase,
     * budgets and usage, draft, checkpoint, and any pending human decision.
     */
    's-workflow/change': SWorkflowChange
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { sWorkflow: SWorkflowService }
}

/** Inputs accepted by {@link SWorkflowService.start}. */
export interface SWorkflowStartRequest {
  readonly definition: SWorkflowRef
  readonly adapter: SWorkflowRef
  readonly preset: SWorkflowPreset
  readonly objective: string
  readonly contract: JsonValue
  readonly budget?: Partial<SWorkflowBudget>
}

/** Defaults are deliberately conservative and may only be raised by a human-owned call. */
export const DEFAULT_WORKFLOW_BUDGETS: Readonly<Record<SWorkflowPreset, SWorkflowBudget>> = {
  focused: {
    maxRounds: 3, maxRequests: 4, maxTokens: 1200, maxActiveMinutes: 5,
    maxChildren: 0, maxConcurrency: 0, maxDelegationDepth: 0,
  },
  goal: {
    maxRounds: 8, maxRequests: 32, maxTokens: 300_000, maxActiveMinutes: 30,
    maxChildren: 0, maxConcurrency: 0, maxDelegationDepth: 0,
  },
  orchestrated: {
    maxRounds: 8, maxRequests: 48, maxTokens: 500_000, maxActiveMinutes: 45,
    maxChildren: 6, maxConcurrency: 3, maxDelegationDepth: 1,
  },
}

const MAX_WORKFLOW_BUDGETS: Readonly<Record<SWorkflowPreset, SWorkflowBudget>> = {
  focused: DEFAULT_WORKFLOW_BUDGETS.focused,
  goal: {
    maxRounds: 24, maxRequests: 96, maxTokens: 1_000_000, maxActiveMinutes: 120,
    maxChildren: 0, maxConcurrency: 0, maxDelegationDepth: 0,
  },
  orchestrated: {
    maxRounds: 24, maxRequests: 144, maxTokens: 2_000_000, maxActiveMinutes: 120,
    maxChildren: 20, maxConcurrency: 4, maxDelegationDepth: 1,
  },
}

function canonical(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit)
    if (item === null || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, visit(child)]))
  }
  return JSON.stringify(visit(value))
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function exactRef(entry: SWorkflowCatalogEntry<{ metadata: { id: string; version: string } }>): SWorkflowResolvedRef {
  return { ...entry.value.metadata, digest: entry.digest }
}

function positive(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${name} is invalid`)
  return value
}

function resolveBudget(preset: SWorkflowPreset, patch: Partial<SWorkflowBudget> = {}): SWorkflowBudget {
  const base = DEFAULT_WORKFLOW_BUDGETS[preset]
  const cap = MAX_WORKFLOW_BUDGETS[preset]
  const result = { ...base, ...patch }
  for (const key of Object.keys(base) as (keyof SWorkflowBudget)[]) {
    positive(result[key], key, key === 'maxChildren' || key === 'maxConcurrency' || key === 'maxDelegationDepth')
    if (result[key] > cap[key]) throw new Error(`${key} exceeds the ${preset} preset cap`)
  }
  if (result.maxConcurrency > result.maxChildren && result.maxChildren !== 0) {
    throw new Error('maxConcurrency cannot exceed maxChildren')
  }
  return result
}

function zeroUsage(): SWorkflowUsage {
  return { rounds: 0, requests: 0, tokens: 0, activeMillis: 0, children: 0 }
}

function catalogKey(value: { id: string; version: string }): string { return `${value.id}@${value.version}` }

function validateIdentity(value: { id: string; version: string }, where: string): void {
  if (!ID.test(value.id) || !VERSION.test(value.version)) throw new Error(`${where} identity is invalid`)
}

/** Validate one definition without accepting executable code. */
export function validateSWorkflowDefinition(value: SWorkflowDefinition): SWorkflowDefinition {
  if (value.apiVersion !== 'dsh.deepseek.ai/v1' || value.kind !== 'WorkflowDefinition') {
    throw new Error('workflow definition apiVersion or kind is invalid')
  }
  validateIdentity(value.metadata, 'workflow definition')
  if (!ID.test(value.service)) throw new Error('workflow definition service is invalid')
  if (value.presets.length === 0 || new Set(value.presets).size !== value.presets.length) {
    throw new Error('workflow definition presets must be non-empty and unique')
  }
  const stepIds = new Set<string>()
  const steps = value.steps.map((step) => {
    if (!ID.test(step.id) || stepIds.has(step.id)) throw new Error(`workflow step id is invalid or duplicated: ${step.id}`)
    if (!['model', 'review', 'delegation', 'checkpoint'].includes(step.kind)) throw new Error(`workflow step kind is invalid: ${step.kind}`)
    if (typeof step.description !== 'string' || step.description.trim() === '') throw new Error(`workflow step ${step.id} needs a description`)
    stepIds.add(step.id)
    return { ...step, description: step.description.trim() }
  })
  if (steps.length === 0) throw new Error('workflow definition needs at least one step')
  return { ...value, metadata: { ...value.metadata }, presets: [...value.presets], steps }
}

/** Validate and detach one service adapter manifest. */
export function validateSWorkflowServiceAdapter(value: SWorkflowServiceAdapter): SWorkflowServiceAdapter {
  if (value.apiVersion !== 'dsh.deepseek.ai/v1' || value.kind !== 'ServiceAdapter') {
    throw new Error('service adapter apiVersion or kind is invalid')
  }
  validateIdentity(value.metadata, 'service adapter')
  if (!ID.test(value.service) || !ID.test(value.reviewKind)) throw new Error('service adapter service or reviewKind is invalid')
  for (const ref of value.promptBundles) validateIdentity(ref, 'prompt bundle')
  const packageNames = [...value.toolPackages, ...value.skillPackages]
  if (packageNames.some(name => typeof name !== 'string' || !/^@?[a-z0-9][a-z0-9@/._-]*$/.test(name))) {
    throw new Error('service adapter package name is invalid')
  }
  return {
    ...value,
    metadata: { ...value.metadata },
    promptBundles: value.promptBundles.map(ref => ({ ...ref })),
    toolPackages: [...new Set(value.toolPackages)],
    skillPackages: [...new Set(value.skillPackages)],
  }
}

const budgetSchema = zod.object({
  maxRounds: zod.number().int().nonnegative(), maxRequests: zod.number().int().nonnegative(),
  maxTokens: zod.number().int().nonnegative(), maxActiveMinutes: zod.number().int().nonnegative(),
  maxChildren: zod.number().int().nonnegative(), maxConcurrency: zod.number().int().nonnegative(),
  maxDelegationDepth: zod.number().int().nonnegative(),
}).strict()
const usageSchema = zod.object({
  rounds: zod.number().int().nonnegative(), requests: zod.number().int().nonnegative(),
  tokens: zod.number().int().nonnegative(), activeMillis: zod.number().int().nonnegative(),
  children: zod.number().int().nonnegative(),
}).strict()
const resolvedRefSchema = zod.object({
  id: zod.string(), version: zod.string(), digest: zod.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()
const snapshotSchema: ZodType<SWorkflowSnapshot> = zod.object({
  runId: zod.string().min(1), revision: zod.number().int().positive(),
  definition: resolvedRefSchema, adapter: resolvedRefSchema,
  preset: zod.enum(['focused', 'goal', 'orchestrated']), service: zod.string().min(1),
  objective: zod.string().min(1), contract: zod.json(),
  status: zod.enum(['active', 'pause-pending', 'paused', 'awaiting-user-input', 'awaiting-user-completion', 'blocked', 'complete', 'cancelled']),
  budget: budgetSchema, usage: usageSchema, draft: zod.json().optional(), draftSummary: zod.string().optional(),
  checkpoint: zod.object({ stepId: zod.string(), note: zod.string() }).strict().optional(),
  pending: zod.object({ kind: zod.enum(['input', 'completion']), prompt: zod.string(), requestedAt: zod.number() }).strict().optional(),
  blockedReason: zod.string().optional(), createdAt: zod.number(), updatedAt: zod.number(),
}).strict() as ZodType<SWorkflowSnapshot>
const projectionStateSchema: ZodType<SWorkflowProjectionState> = zod.object({
  current: snapshotSchema.nullable(), failure: zod.string().nullable(),
}).strict()
const changeSchema = zod.object({
  kind: zod.literal('s-workflow/change'),
  version: zod.literal(1),
  operation: zod.string().min(1),
  workflow: snapshotSchema,
}).strict()

/** Pure strict fold used by the projection registry and tests. */
export function applySWorkflowProjection(state: SWorkflowProjectionState, event: SessionEvent): SWorkflowProjectionState {
  if (state.failure !== null || event.type !== 's-workflow/change') return state
  try {
    const next = changeSchema.parse(event.data).workflow
    const current = state.current
    if ((current === null || next.runId !== current.runId) && next.revision !== 1) {
      throw new Error('a new workflow must begin at revision 1')
    }
    if (current !== null && next.runId === current.runId && next.revision !== current.revision + 1) {
      throw new Error('workflow revision is not consecutive')
    }
    if (current !== null && ACTIVE.includes(current.status) && next.runId !== current.runId) {
      throw new Error('a nonterminal workflow was replaced')
    }
    return { current: next, failure: null }
  } catch (error: unknown) {
    return { ...state, failure: error instanceof Error ? error.message : String(error) }
  }
}

/** Durable client-visible workflow projection. */
export const sWorkflowProjectionDefinition = {
  key: 'sWorkflow', stateVersion: 1, stateSchema: projectionStateSchema,
  init: (): SWorkflowProjectionState => ({ current: null, failure: null }),
  apply: applySWorkflowProjection,
  wire: { viewSchema: snapshotSchema.nullable(), view: state => state.current },
} satisfies ProjectionDefinition<'sWorkflow', SWorkflowProjectionState>

/** Sealed catalogs and state-machine owner. */
export class SWorkflowService extends Service {
  static inject = ['agents', 'sessionProjections']
  private readonly definitions = new Map<string, SWorkflowCatalogEntry<SWorkflowDefinition>>()
  private readonly adapters = new Map<string, SWorkflowCatalogEntry<SWorkflowServiceAdapter>>()
  private sealed = false

  constructor(ctx: Context) {
    super(ctx, 'sWorkflow')
    ctx.sessionProjections.register(sWorkflowProjectionDefinition)
  }

  registerDefinition(input: SWorkflowDefinition, source = 'inline'): () => void {
    if (this.sealed) throw new Error('workflow catalog is sealed')
    const value = validateSWorkflowDefinition(input)
    return this.register(this.definitions, value, source)
  }

  registerAdapter(input: SWorkflowServiceAdapter, source = 'inline'): () => void {
    if (this.sealed) throw new Error('workflow catalog is sealed')
    const value = validateSWorkflowServiceAdapter(input)
    return this.register(this.adapters, value, source)
  }

  seal(): void { this.sealed = true }
  isSealed(): boolean { return this.sealed }

  catalog(service?: string, preset?: SWorkflowPreset): {
    definitions: readonly SWorkflowCatalogEntry<SWorkflowDefinition>[]
    adapters: readonly SWorkflowCatalogEntry<SWorkflowServiceAdapter>[]
  } {
    const definitions = [...this.definitions.values()].filter(entry =>
      (service === undefined || entry.value.service === service || entry.value.service === 'generic')
      && (preset === undefined || entry.value.presets.includes(preset)))
    const adapters = [...this.adapters.values()].filter(entry => service === undefined || entry.value.service === service)
    return { definitions, adapters }
  }

  get(agent: Agent): SWorkflowProjection {
    this.assertLive(agent)
    const state = this.ctx.sessionProjections.stateOf(agent.session, 'sWorkflow')
    if (state === undefined) throw new Error('s-workflow projection is not registered')
    if (state.failure !== null) throw new Error(`s-workflow replay failed: ${state.failure}`)
    const current = state.current
    if (current === null) return null
    const definition = this.need(this.definitions, current.definition, 'workflow definition')
    const adapter = this.need(this.adapters, current.adapter, 'service adapter')
    if (definition.digest !== current.definition.digest || adapter.digest !== current.adapter.digest) {
      throw new Error('s-workflow replay failed: catalog content digest changed')
    }
    if (adapter.value.service !== current.service
      || (definition.value.service !== 'generic' && definition.value.service !== current.service)) {
      throw new Error('s-workflow replay failed: catalog service identity changed')
    }
    return current
  }

  start(agent: Agent, request: SWorkflowStartRequest): SWorkflowSnapshot {
    this.assertLive(agent)
    const current = this.get(agent)
    if (current !== null && ACTIVE.includes(current.status)) throw new Error('session already has a nonterminal workflow')
    const definition = this.need(this.definitions, request.definition, 'workflow definition')
    const adapter = this.need(this.adapters, request.adapter, 'service adapter')
    if (definition.value.service !== 'generic' && definition.value.service !== adapter.value.service) {
      throw new Error('workflow and adapter services differ')
    }
    if (!definition.value.presets.includes(request.preset)) throw new Error('workflow does not support the selected preset')
    const objective = request.objective.trim()
    if (objective === '') throw new Error('workflow objective must be non-empty')
    const now = Date.now()
    const workflow: SWorkflowSnapshot = {
      runId: `workflow-${randomUUID()}`, revision: 1,
      definition: exactRef(definition), adapter: exactRef(adapter), preset: request.preset,
      service: adapter.value.service, objective, contract: request.contract,
      status: 'active', budget: resolveBudget(request.preset, request.budget), usage: zeroUsage(),
      createdAt: now, updatedAt: now,
    }
    return this.commit(agent, 'start', workflow)
  }

  updateDraft(agent: Agent, ref: SWorkflowRunRef, draft: JsonValue, summary: string): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['active'])
    if (summary.trim() === '') throw new Error('draft summary must be non-empty')
    return this.replace(agent, 'draft', current, { draft, draftSummary: summary.trim() })
  }

  checkpoint(agent: Agent, ref: SWorkflowRunRef, stepId: string, note: string, usage: Partial<SWorkflowUsage> = {}): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['active'])
    if (!ID.test(stepId) || note.trim() === '') throw new Error('checkpoint step or note is invalid')
    const nextUsage = { ...current.usage }
    for (const key of Object.keys(nextUsage) as (keyof SWorkflowUsage)[]) {
      const delta = usage[key] ?? 0
      positive(delta, `usage.${key}`, true)
      nextUsage[key] += delta
    }
    this.assertWithinBudget(current.budget, nextUsage)
    return this.replace(agent, 'checkpoint', current, {
      checkpoint: { stepId, note: note.trim() }, usage: nextUsage,
    })
  }

  requestInput(agent: Agent, ref: SWorkflowRunRef, prompt: string): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['active'])
    return this.wait(agent, current, 'input', prompt)
  }

  requestCompletion(agent: Agent, ref: SWorkflowRunRef, prompt: string): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['active'])
    if (current.draft === undefined) throw new Error('completion review requires a workflow draft')
    return this.wait(agent, current, 'completion', prompt)
  }

  answerInput(agent: Agent, ref: SWorkflowRunRef, answer: string): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['awaiting-user-input'])
    if (answer.trim() === '') throw new Error('workflow answer must be non-empty')
    return this.replace(agent, 'answer-input', current, {
      status: 'active', pending: undefined,
      checkpoint: { stepId: 'user-input', note: answer.trim() },
    })
  }

  approveCompletion(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ['awaiting-user-completion'])
    return this.replace(agent, 'complete', current, { status: 'complete', pending: undefined })
  }

  pause(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot {
    return this.replace(agent, 'pause', this.expect(agent, ref, ['active']), { status: 'paused' })
  }

  resume(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot {
    return this.replace(agent, 'resume', this.expect(agent, ref, ['paused', 'blocked']), {
      status: 'active', blockedReason: undefined,
    })
  }

  cancel(agent: Agent, ref: SWorkflowRunRef): SWorkflowSnapshot {
    return this.replace(agent, 'cancel', this.expect(agent, ref, ACTIVE), { status: 'cancelled', pending: undefined })
  }

  raiseBudgets(agent: Agent, ref: SWorkflowRunRef, patch: Partial<SWorkflowBudget>): SWorkflowSnapshot {
    const current = this.expect(agent, ref, ACTIVE)
    const budget = resolveBudget(current.preset, { ...current.budget, ...patch })
    for (const key of Object.keys(current.budget) as (keyof SWorkflowBudget)[]) {
      if (budget[key] < current.budget[key]) throw new Error('workflow budgets cannot be lowered')
    }
    return this.replace(agent, 'raise-budgets', current, { budget })
  }

  private register<T extends { metadata: { id: string; version: string } }>(
    catalog: Map<string, SWorkflowCatalogEntry<T>>, value: T, source: string,
  ): () => void {
    const key = catalogKey(value.metadata)
    if (catalog.has(key)) throw new Error(`duplicate catalog entry ${key}`)
    const entry = { value, digest: digest(value), source }
    catalog.set(key, entry)
    return () => { if (catalog.get(key) === entry) catalog.delete(key) }
  }

  private need<T>(
    catalog: Map<string, SWorkflowCatalogEntry<T>>, ref: { id: string; version: string }, label: string,
  ): SWorkflowCatalogEntry<T> {
    const entry = catalog.get(catalogKey(ref))
    if (entry === undefined) throw new Error(`unknown ${label} ${catalogKey(ref)}`)
    return entry
  }

  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error(`agent ${agent.id} is not live`)
  }

  private expect(agent: Agent, ref: SWorkflowRunRef, statuses: readonly SWorkflowStatus[]): SWorkflowSnapshot {
    const current = this.get(agent)
    if (current === null) throw new Error('session has no workflow')
    if (current.runId !== ref.runId || current.revision !== ref.revision) throw new Error('stale workflow revision')
    if (!statuses.includes(current.status)) throw new Error(`workflow status ${current.status} does not allow this operation`)
    return current
  }

  private wait(agent: Agent, current: SWorkflowSnapshot, kind: 'input' | 'completion', prompt: string): SWorkflowSnapshot {
    if (prompt.trim() === '') throw new Error('workflow decision prompt must be non-empty')
    return this.replace(agent, `request-${kind}`, current, {
      status: kind === 'input' ? 'awaiting-user-input' : 'awaiting-user-completion',
      pending: { kind, prompt: prompt.trim(), requestedAt: Date.now() },
    })
  }

  private replace(
    agent: Agent,
    operation: string,
    current: SWorkflowSnapshot,
    patch: { [K in keyof SWorkflowSnapshot]?: SWorkflowSnapshot[K] | undefined },
  ): SWorkflowSnapshot {
    const patchEntries = Object.entries(patch)
    const removed = new Set(patchEntries.filter(([, value]) => value === undefined).map(([key]) => key))
    const mutable = Object.fromEntries([
      ...Object.entries(current).filter(([key]) => !removed.has(key)),
      ...patchEntries.filter(([, value]) => value !== undefined),
    ])
    const workflow = {
      ...mutable, runId: current.runId, revision: current.revision + 1,
      createdAt: current.createdAt, updatedAt: Math.max(Date.now(), current.updatedAt),
    } as unknown as SWorkflowSnapshot
    return this.commit(agent, operation, workflow)
  }

  private commit(agent: Agent, operation: string, workflow: SWorkflowSnapshot): SWorkflowSnapshot {
    agent.session.append('s-workflow/change', { kind: 's-workflow/change', version: 1, operation, workflow })
    const state = this.get(agent)
    if (state === null) throw new Error('workflow commit did not project')
    return state
  }

  private assertWithinBudget(budget: SWorkflowBudget, usage: SWorkflowUsage): void {
    if (usage.rounds > budget.maxRounds || usage.requests > budget.maxRequests
      || usage.tokens > budget.maxTokens || usage.activeMillis > budget.maxActiveMinutes * 60_000
      || usage.children > budget.maxChildren) throw new Error('workflow resource budget exceeded')
  }
}

export default SWorkflowService
