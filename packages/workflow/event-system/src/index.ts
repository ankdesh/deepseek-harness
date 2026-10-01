/** Persistent conversation event agents, native execution hooks, and aggregate budgets. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, TokenUsage, MessageId } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { snapshotSchema, waitSchema } from './schema.ts'
import { EventSystemLedger, validateDefinition } from './ledger.ts'
import { installEventTools } from './tools.ts'
import type {
  EventAgentDefinition,
  EventSystemDefinition,
  EventSystemMembership,
  EventSystemSnapshot,
  ExecutionLimits,
  PublishEventInput,
  EventId,
  DeliveryId,
  ActivationId,
  WaitId,
  WaitRequest,
  EventWait,
} from './types.ts'
export type * from './types.ts'
export { validateDefinition } from './ledger.ts'

const spec = defineDomain({
  name: 'event_systems',
  version: 1,
  tables: { systems: domainTable<SessionId, EventSystemSnapshot>(snapshotSchema) },
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    eventSystems: EventSystemService
  }
}

/** Owns specialists and scheduling; the primary native agent remains owned by its caller. */
export default class EventSystemService extends Service {
  static inject = ['agents', 'sessionPersistence', 'storageDomain', 'tokenMeter']
  /** Resolves after domain loading and human-gated restart reconstruction. */
  readonly ready: Promise<void>
  private readonly definitions = new Map<string, EventSystemDefinition>()
  private readonly composed = new WeakSet<Agent>()
  private sealed = false
  private domain: Domain<typeof spec> | undefined
  private _ledger: EventSystemLedger | undefined

  private get ledger(): EventSystemLedger {
    if (!this._ledger) throw new Error('Event system is not ready')
    return this._ledger
  }

  private isStopping(): boolean {
    return this.stopping
  }
  private stopping = false
  private turns = new Map<SessionId, number>()
  private handles = new Map<SessionId, AgentHandle>()
  private pumps = new Map<SessionId, Promise<void>>()
  private jobs = new Set<Promise<unknown>>()
  private retryTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  private timeLimits = new Map<SessionId, ReturnType<typeof setTimeout>>()

  constructor(ctx: Context) {
    super(ctx, 'eventSystems')
    this.ready = (async () => {
      this.domain = await ctx.storageDomain.open(spec)
      this._ledger = new EventSystemLedger(this.domain.table('systems'))
      await this.ledger.recover()
    })()
    ctx.on(
      'agent/pre-step',
      async ({ agent, turn, step }, next) => {
        await this.ready
        const membership = this.membership(agent.id)
        if (!membership) return next()
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        const snapshot = this.get(membership.conversationId)!
        if (
          this.isStopping() ||
          snapshot.status !== 'active' ||
          snapshot.waits?.some(wait => wait.member === membership.member && wait.state === 'waiting')
        )
          return { kind: 'reject' }
        const decision = await next()
        if (decision.kind !== 'enter') return decision
        if (!(await this.ledger.admitRound(snapshot.conversationId, `${agent.id}:${turn}`))) return { kind: 'reject' }
        this.turns.set(agent.id, turn)
        if (step === 1 && membership.primary && snapshot.mode === 'orchestrated') {
          for (const message of decision.messages)
            if (message.source.kind === 'user') {
              const text = message.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n')
              await this.publishHost(snapshot.conversationId, {
                type: 'user.requested',
                payload: { text },
                producer: 'human',
                dedupeKey: message.id,
              })
            }
        }
        return decision
      },
      { global: true },
    )
    ctx.on(
      'agent/request',
      async ({ agent }, next) => {
        const options = await next()
        const membership = this.membership(agent.id)
        if (!membership) return options
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        const limit = this.get(membership.conversationId)!.limits.maxOutputTokens
        return { ...options, maxTokens: Math.min(options.maxTokens ?? limit, limit) }
      },
      { global: true },
    )
    const meter = this.meter.bind(this)
    ctx.on(
      'llm/stream',
      async function* (options, next) {
        yield* meter(options, next)
      },
      { global: true },
    )
    ctx.on(
      'session/event',
      (session, event) => {
        const membership = this.membership(session.id)
        if (!membership) return
        if (event.type === 'user/message' || event.type === 'turn/end') this.track(this.observe(membership, event))
      },
      { global: true },
    )
    ctx.on(
      'agent/status',
      ({ agent, status }) => {
        if (status !== 'idle') return
        const membership = this.membership(agent.id)
        if (membership) this.schedule(membership.conversationId)
      },
      { global: true },
    )
    ctx.effect(() => () => this.close())
  }

  /**
   * Register an exact trusted template; the returned disposer removes only this contribution.
   * @param input - trusted resolved definition.
   * @returns disposer for this exact registration.
   */
  registerDefinition(input: EventSystemDefinition): () => void {
    if (this.sealed) throw new Error('Event-system catalog is sealed')
    const definition = validateDefinition(input)
    const key = `${definition.id}@${definition.version}`
    if (this.definitions.has(key)) throw new Error(`Duplicate event-system definition ${key}`)
    this.definitions.set(key, definition)
    return () => {
      if (this.definitions.get(key) === definition) this.definitions.delete(key)
    }
  }

  /**
   * Resolve an exact template version; missing configuration fails before conversation execution.
   * @param id - catalog identity.
   * @param version - exact catalog version.
   * @returns registered immutable definition.
   */
  definition(id: string, version: string): EventSystemDefinition {
    const definition = this.definitions.get(`${id}@${version}`)
    if (!definition) throw new Error(`Missing event-system definition ${id}@${version}`)
    return definition
  }

  /** Prevent new catalog registrations after trusted startup composition. */
  seal(): void {
    this.sealed = true
  }

  /**
   * Locate a member by native session identity; routing never accepts another conversation.
   * @param sessionId - native member identity.
   * @returns owning conversation and role, if configured.
   */
  membership(sessionId: SessionId): EventSystemMembership | undefined {
    if (!this._ledger) return undefined
    for (const snapshot of this.ledger.list()) {
      const member = snapshot.members.find(item => item.sessionId === sessionId)
      if (member)
        return {
          conversationId: snapshot.conversationId,
          member: member.id,
          primary: member.id === snapshot.definition.primary,
        }
    }
    return undefined
  }

  /**
   * Read committed state.
   * @param id - primary conversation identity.
   * @returns committed pinned state, if configured.
   */
  get(id: SessionId): EventSystemSnapshot | undefined {
    return this._ledger?.get(id)
  }

  /**
   * Pin a new conversation or attach to its existing configuration without rearming recovered state.
   * @param primary - caller-owned native primary agent.
   * @param mode - immutable conversation execution mode.
   * @param definition - resolved trusted roster and subscriptions.
   * @param limits - explicit aggregate resource bounds.
   * @returns existing or newly pinned conversation state.
   */
  async attach(
    primary: Agent,
    mode: EventSystemSnapshot['mode'],
    definition: EventSystemDefinition,
    limits: ExecutionLimits,
  ): Promise<EventSystemSnapshot> {
    await this.ready
    let snapshot = this.get(primary.id)
    if (!snapshot) {
      const agents = definition.agents.map((member) => {
        const provider = member.provider ?? primary.options.provider
        const model = member.model ?? primary.options.model
        if (!provider || !model)
          throw new Error('Event agents require a configured provider/model or the primary selected route')
        return { ...member, provider, model }
      })
      snapshot = await this.ledger.create(primary.id, mode, { ...definition, agents }, limits)
    }
    if (snapshot.mode !== mode) throw new Error('Conversation execution mode is immutable')
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    const member = snapshot.definition.agents.find(item => item.id === snapshot.definition.primary)!
    this.compose(primary, member)
    return snapshot
  }

  private compose(agent: Agent, definition: EventAgentDefinition): void {
    if (this.composed.has(agent)) return
    this.composed.add(agent)
    agent.ctx.systemPrompt.section({
      name: 'event-system:member',
      order: agent.ctx.systemPrompt.getSectionOrder('EVENT_SYSTEM_MEMBER'),
      text: definition.prompt,
    })
    installEventTools(agent.ctx, this, definition.tools)
    const allowed = new Set(definition.tools)
    agent.ctx.tools.guard(exec =>
      allowed.has(exec.name) ? undefined : `Tool ${exec.name} is not permitted for event agent ${definition.id}`,
    )
  }

  /**
   * Publish on behalf of the exact live calling member; producer and causal identity are host-owned.
   * @param agent - exact live initiator.
   * @param type - declared permitted event type.
   * @param payload - JSON payload validated against the event schema.
   * @param dedupeKey - stable producer key for the same result.
   * @returns durably committed event identity.
   */
  async publishAgent(agent: Agent, type: string, payload: JsonValue, dedupeKey: string): Promise<EventId> {
    const membership = this.membership(agent.id)
    if (
      !membership ||
      this.ctx.agents.get(agent.id) !== agent ||
      this.ctx.agents.currentInitiator() !== agent ||
      agent.status !== 'running'
    )
      throw new Error('Event publication requires the live calling member')
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    const snapshot = this.get(membership.conversationId)!
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    const definition = snapshot.definition.agents.find(member => member.id === membership.member)!
    if (!definition.publishes.includes(type)) throw new Error(`Agent ${membership.member} may not publish ${type}`)
    const active = snapshot.deliveries.find(
      delivery => delivery.target === membership.member && delivery.state === 'accepted',
    )
    const causation = active?.eventId ?? snapshot.events.findLast(event => event.type === 'user.requested')?.id
    const id = await this.ledger.publish(snapshot.conversationId, {
      type,
      payload,
      producer: membership.member,
      dedupeKey,
      ...(causation ? { causation } : {}),
    })
    this.schedule(snapshot.conversationId)
    return id
  }

  /**
   * Admit a trusted application/user event after payload validation and before scheduling.
   * @param id - primary conversation identity.
   * @param input - trusted validated publication request.
   * @param revision - optional exact human-observed revision.
   * @returns durably committed event identity.
   */
  async publishHost(id: SessionId, input: PublishEventInput, revision?: number): Promise<EventId> {
    await this.ready
    const eventId = await this.ledger.publish(id, input, true, false, revision)
    this.resumeResolvedGoals(id)
    this.schedule(id)
    return eventId
  }

  /**
   * Pause new admissions while letting the current tool result settle, for host review gates.
   * @param id - primary conversation identity.
   * @param reason - visible host review reason.
   * @returns committed state without cancelling the current tool.
   */
  async hold(id: SessionId, reason: string): Promise<EventSystemSnapshot> {
    await this.ready
    return this.ledger.update(id, current =>
      current.status === 'active' ? { ...current, status: 'paused', reason } : current,
    )
  }

  /**
   * Human lifecycle mutation using the exact observed revision; Resume preserves all spending.
   * @param id - primary conversation identity.
   * @param revision - exact observed revision.
   * @param action - human-authorized lifecycle change.
   * @returns committed state after scheduling or quiescence.
   */
  async control(id: SessionId, revision: number, action: 'pause' | 'resume' | 'stop'): Promise<EventSystemSnapshot> {
    await this.ready
    const snapshot = await this.ledger.update(id, (current) => {
      if (current.revision !== revision) throw new Error('Execution state changed; reload before acting')
      if (current.status === 'stopped') throw new Error('Stopped systems cannot be resumed')
      if (action === 'resume' && current.status === 'exhausted')
        throw new Error('Budget exhausted; Resume cannot authorize more resources')
      return {
        ...current,
        status: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'stopped',
        reason: '',
        ...(current.waits
          ? {
            waits: current.waits.map(wait =>
              action === 'stop' && wait.state === 'waiting' ? { ...wait, state: 'cancelled' as const } : wait,
            ),
          }
          : {}),
        deliveries: current.deliveries.map(delivery =>
          action === 'stop' && ['pending', 'dispatching', 'accepted'].includes(delivery.state)
            ? { ...delivery, state: 'cancelled' as const }
            : delivery,
        ),
      }
    })
    if (action === 'resume') {
      this.resumeResolvedGoals(id)
      await this.queueSafeRetries(id)
      this.schedule(id)
    } else {
      const agents = snapshot.members
        .map(member => this.ctx.agents.get(member.sessionId))
        .filter((agent): agent is Agent => agent !== undefined)
      for (const agent of agents) agent.cancel({ kind: 'parent' })
      await Promise.all(agents.map(agent => agent.whenIdle()))
      const pump = this.pumps.get(id)
      if (pump) await pump
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    return this.get(id)!
  }

  /**
   * Explicitly retry uncertain work; the caller must acknowledge possible prior effects.
   * @param id - primary conversation identity.
   * @param revision - exact observed revision.
   * @param deliveryId - failed or interrupted attempt identity.
   * @param acknowledgeUncertainty - explicit human acknowledgement of possible prior effects.
   * @returns committed state retaining the previous attempt.
   */
  async retry(
    id: SessionId,
    revision: number,
    deliveryId: DeliveryId,
    acknowledgeUncertainty: boolean,
  ): Promise<EventSystemSnapshot> {
    await this.ready
    const snapshot = await this.ledger.update(id, (current) => {
      if (current.revision !== revision || !acknowledgeUncertainty || current.status !== 'active')
        throw new Error('Retry requires current active state and explicit uncertainty acknowledgement')
      const selected = current.deliveries.find(delivery => delivery.id === deliveryId)
      if (!selected || !['interrupted', 'failed'].includes(selected.state)) throw new Error('Delivery is not retryable')
      if (current.deliveries.some(item => item.retryOf === deliveryId))
        throw new Error('This attempt already has a retry')
      if (
        selected.attempt >= current.limits.maxRequests ||
        current.deliveries.filter(item => ['pending', 'dispatching', 'accepted'].includes(item.state)).length >=
          current.limits.maxPending
      )
        throw new Error('Retry limit exceeded')
      return {
        ...current,
        deliveries: [
          ...current.deliveries,
          {
            ...selected,
            id: randomUUID() as DeliveryId,
            attempt: selected.attempt + 1,
            retryOf: selected.id,
            state: 'pending' as const,
            messageId: randomUUID() as MessageId,
            activationId: randomUUID() as ActivationId,
            turn: null,
            error: '',
            ...(current.definition.subscriptions.find(subscription => subscription.id === selected.subscription)
              ?.retry
              ? {
                notBefore:
                    Date.now() +
                    Math.min(
                      current.definition.subscriptions.find(subscription => subscription.id === selected.subscription)
                        ?.retry?.maxBackoffMillis ?? 0,
                      (current.definition.subscriptions.find(
                        subscription => subscription.id === selected.subscription,
                      )?.retry?.initialBackoffMillis ?? 0) *
                        2 ** (selected.attempt - 1),
                    ),
              }
              : {}),
          },
        ],
      }
    })
    this.schedule(id)
    return snapshot
  }

  /**
   * List persisted conversations for trusted source adapters.
   * @returns all pinned conversation snapshots.
   */
  list(): EventSystemSnapshot[] {
    return this._ledger?.list() ?? []
  }

  /**
   * Publish a source observation only while the owning conversation has active authority.
   * @param id - owning conversation.
   * @param input - validated source outbox item.
   * @returns durable event identity for idempotent source acknowledgement.
   */
  async publishTrigger(id: SessionId, input: PublishEventInput): Promise<EventId> {
    await this.ready
    const result = await this.ledger.publish(id, input, true, true)
    this.resumeResolvedGoals(id)
    this.schedule(id)
    return result
  }

  /**
   * Persist a future correlated wait and disarm native goal continuation without spending rounds.
   * @param agent - exact live member executing the waiting tool.
   * @param request - declared event or host-human response request.
   * @returns committed wait with its host-generated response identity.
   */
  async wait(agent: Agent, request: WaitRequest): Promise<EventWait> {
    const member = this.membership(agent.id)
    if (
      !member ||
      this.ctx.agents.get(agent.id) !== agent ||
      this.ctx.agents.currentInitiator() !== agent ||
      agent.status !== 'running'
    )
      throw new Error('Waiting requires the live calling member')
    const state = this.get(member.conversationId)
    if (!state || state.status !== 'active') throw new Error('Execution is not active')
    const id = randomUUID() as WaitId
    const human = request.kind === 'human'
    const eventType = human ? 'system.wait.answered' : request.eventType
    if (
      !eventType ||
      (!human && !(eventType in state.definition.events)) ||
      !request.reason.trim() ||
      (!human && (!request.matchKey || request.matchValue === undefined))
    )
      throw new Error('Wait requires a declared event and exact response correlation')
    if (state.waits?.some(wait => wait.member === member.member && wait.state === 'waiting'))
      throw new Error('Member is already waiting')
    if ((state.waits?.length ?? 0) >= state.limits.maxEvents || Buffer.byteLength(JSON.stringify(request)) > state.limits.maxPayloadBytes)
      throw new Error('Wait admission limit exceeded')
    const active = state.deliveries.find(
      delivery => delivery.target === member.member && delivery.state === 'accepted',
    )
    const goals = this.ctx.get('goals')
    const currentGoal = state.mode === 'goal' && member.primary ? goals?.get(agent) : undefined
    const wait = waitSchema.parse({
      id, member: member.member, kind: request.kind, reason: request.reason, eventType,
      matchKey: human ? 'wait_id' : request.matchKey, matchValue: human ? id : request.matchValue,
      state: 'waiting', afterEvents: state.events.length, causation: active?.eventId ?? null, response: null,
      ...(currentGoal?.phase === 'active' ? { goal: { id: currentGoal.id, revision: currentGoal.revision + 1 } } : {}),
    })
    if (Buffer.byteLength(JSON.stringify(wait)) > state.limits.maxPayloadBytes)
      throw new Error('Complete wait exceeds byte limit')
    // Validate the full record before disarming the native goal.
    if (currentGoal?.phase === 'active') goals?.block(agent, currentGoal, { code: 'event-wait', message: request.reason })
    await this.ledger.update(state.conversationId, (current) => {
      if (current.status !== 'active' || (current.waits?.length ?? 0) >= current.limits.maxEvents || current.waits?.some(item => item.member === member.member && item.state === 'waiting'))
        throw new Error('Wait admission limit exceeded')
      return { ...current, waits: [...(current.waits ?? []), { ...wait, afterEvents: current.events.length }] }
    })
    return wait
  }

  /**
   * Answer one exact human wait; stale answers cannot wake another activation.
   * @param id - owning conversation.
   * @param revision - observed execution revision.
   * @param waitId - current human response identity.
   * @param answer - bounded human answer logged through the native inbox.
   * @returns durable response event identity.
   */
  async answerWait(id: SessionId, revision: number, waitId: WaitId, answer: string): Promise<EventId> {
    const state = this.get(id)
    const wait = state?.waits?.find(item => item.id === waitId)
    if (
      !state ||
      state.revision !== revision ||
      state.status !== 'active' ||
      !wait ||
      wait.state !== 'waiting' ||
      wait.kind !== 'human' ||
      !answer.trim()
    )
      throw new Error('Answer requires the current active human wait')
    return this.publishHost(
      id,
      {
        type: 'system.wait.answered',
        payload: { wait_id: waitId, answer },
        producer: 'human',
        dedupeKey: waitId,
        ...(wait.causation ? { causation: wait.causation } : {}),
      },
      revision,
    )
  }

  private resumeResolvedGoals(id: SessionId): void {
    const state = this.get(id)
    if (state?.status !== 'active' || state.mode !== 'goal') return
    const goals = this.ctx.get('goals')
    const agent = this.ctx.agents.get(id)
    if (!goals || !agent) return
    for (const wait of state.waits ?? []) {
      if (wait.state !== 'resolved' || !wait.goal) continue
      const goal = goals.get(agent)
      if (
        goal?.id === wait.goal.id &&
        goal.revision === wait.goal.revision &&
        goal.phase === 'blocked' &&
        goal.roundsStarted < goal.maxGoalRounds &&
        goal.blockedReason?.code === 'event-wait'
      )
        goals.resume(agent, { id: wait.goal.id as GoalId, revision: wait.goal.revision })
    }
  }

  private async queueSafeRetries(id: SessionId): Promise<void> {
    const state = this.get(id)
    if (state?.status !== 'active') return
    for (const delivery of state.deliveries) {
      const policy = state.definition.subscriptions.find(
        subscription => subscription.id === delivery.subscription,
      )?.retry
      if (
        !policy ||
        delivery.state !== 'failed' ||
        delivery.attempt >= Math.min(policy.maxAttempts, state.limits.maxRequests) ||
        state.deliveries.some(item => item.retryOf === delivery.id)
      )
        continue
      await this.retry(id, this.get(id)?.revision ?? 0, delivery.id, true)
    }
  }

  private track<T>(job: Promise<T>): void {
    this.jobs.add(job)
    void job
      .catch((error: unknown) => {
        this.ctx.logger.error(error)
      })
      .finally(() => this.jobs.delete(job))
  }

  private schedule(id: SessionId): void {
    if (this.stopping || this.pumps.has(id)) return
    const job = Promise.resolve().then(() => this.pump(id))
    this.pumps.set(id, job)
    this.track(
      job.finally(() => {
        this.pumps.delete(id)
        const state = this.get(id)
        if (
          !this.stopping &&
          state?.status === 'active' &&
          new Set([
            ...state.members
              .filter(member => this.ctx.agents.get(member.sessionId)?.status === 'running')
              .map(member => member.id),
            ...state.deliveries
              .filter(item => ['accepted', 'dispatching'].includes(item.state))
              .map(item => item.target),
          ]).size < state.limits.maxConcurrency &&
          state.deliveries.some(
            item =>
              item.state === 'pending' &&
              (item.notBefore ?? 0) <= Date.now() &&
              !state.waits?.some(wait => wait.member === item.target && wait.state === 'waiting') &&
              !state.deliveries.some(
                active => active.target === item.target && ['accepted', 'dispatching'].includes(active.state),
              ) &&
              // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
              this.ctx.agents.get(state.members.find(member => member.id === item.target)!.sessionId)?.status !==
                'running',
          )
        )
          this.schedule(id)
      }),
    )
  }

  private async pump(id: SessionId): Promise<void> {
    await this.ready
    while (!this.stopping) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
      const snapshot = this.get(id)!
      if (snapshot.status !== 'active') return
      this.armRetryTimer(snapshot)
      const active = snapshot.deliveries.filter(delivery => ['dispatching', 'accepted'].includes(delivery.state))
      const busy = new Set(
        snapshot.members
          .filter(member => this.ctx.agents.get(member.sessionId)?.status === 'running')
          .map(member => member.id),
      )
      for (const item of active) busy.add(item.target)
      if (busy.size >= snapshot.limits.maxConcurrency) return
      const delivery = snapshot.deliveries.find(
        delivery =>
          delivery.state === 'pending' &&
          (delivery.notBefore ?? 0) <= Date.now() &&
          !snapshot.waits?.some(wait => wait.member === delivery.target && wait.state === 'waiting') &&
          !active.some(item => item.target === delivery.target) &&
          // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
          this.ctx.agents.get(snapshot.members.find(member => member.id === delivery.target)!.sessionId)?.status !==
            'running',
      )
      if (!delivery) return
      await this.ledger.update(id, current => ({
        ...current,
        deliveries: current.deliveries.map(item =>
          item.id === delivery.id ? { ...item, state: 'dispatching' as const } : item,
        ),
      }))
      try {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        const member = snapshot.members.find(member => member.id === delivery.target)!
        let agent = this.ctx.agents.get(member.sessionId)
        if (!agent) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
          const definition = snapshot.definition.agents.find(item => item.id === member.id)!
          const setup = (_ctx: Context, created: Agent) => {
            this.compose(created, definition)
          }
          const agentOptions = {
            ...(definition.provider ? { provider: definition.provider } : {}),
            ...(definition.model ? { model: definition.model } : {}),
          }
          const persisted = await this.ctx.sessionPersistence.stat(member.sessionId)
          const handle =
            persisted !== undefined
              ? await this.ctx.agents.resume({ resumeSessionId: member.sessionId, agentOptions, setup })
              : await this.ctx.agents.create({
                sessionId: member.sessionId,
                agentOptions,
                meta: { ...(definition.agentPreset ? { agentPreset: definition.agentPreset } : {}) },
                setup,
              })
          this.handles.set(member.sessionId, handle)
          agent = handle.agent
          await this.ledger.update(id, current => ({
            ...current,
            members: current.members.map(item => (item.id === member.id ? { ...item, created: true } : item)),
          }))
        }
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        if (this.isStopping() || this.get(id)!.status !== 'active') {
          await this.ledger.update(id, current => ({
            ...current,
            deliveries: current.deliveries.map(item =>
              item.id === delivery.id && item.state === 'dispatching' ? { ...item, state: 'pending' as const } : item,
            ),
          }))
          return
        }
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        const event = snapshot.events.find(event => event.id === delivery.eventId)!
        this.resumeResolvedGoals(id)
        const input = createUserMessage({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ event, activation_id: delivery.activationId, subscription: delivery.subscription }),
            },
          ],
          source: { kind: 'plugin', plugin: 'event-system', form: 'relay' },
        })
        const message = freezeMessage({ ...input, id: delivery.messageId })
        if (
          !agent.inbox.nextTurn.some(item => item.id === message.id) &&
          !agent.inbox.nextStep.some(item => item.id === message.id)
        )
          agent.followup(message)
      } catch (error) {
        await this.ledger.update(id, current => ({
          ...current,
          deliveries: current.deliveries.map(item =>
            item.id === delivery.id && item.state === 'dispatching'
              ? { ...item, state: 'failed' as const, error: String(error) }
              : item,
          ),
        }))
        await this.queueSafeRetries(id)
      }
    }
  }

  private async observe(membership: EventSystemMembership, event: SessionEvent): Promise<void> {
    const id = membership.conversationId
    if (event.type === 'user/message') {
      await this.ledger.update(id, current => ({
        ...current,
        deliveries: current.deliveries.map(delivery =>
          delivery.messageId === event.data.id && delivery.state === 'dispatching'
            ? {
              ...delivery,
              state: 'accepted' as const,
              // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
              turn: this.turns.get(current.members.find(member => member.id === delivery.target)!.sessionId) ?? null,
            }
            : delivery,
        ),
      }))
    } else if (event.type === 'turn/end') {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
      const active = this.get(id)!.deliveries.find(
        delivery =>
          delivery.target === membership.member && delivery.state === 'accepted' && delivery.turn === event.data.turn,
      )
      if (!active) return
      const kind = event.data.reason.kind
      const state =
        kind === 'completed' ? 'completed' : kind === 'aborted' || kind === 'interrupted' ? 'interrupted' : 'failed'
      await this.ledger.update(id, current => ({
        ...current,
        deliveries: current.deliveries.map(delivery =>
          delivery.id === active.id && delivery.state === 'accepted'
            ? { ...delivery, state, error: state === 'completed' ? '' : JSON.stringify(event.data.reason) }
            : delivery,
        ),
      }))
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
      if (this.get(id)!.status !== 'stopped')
        await this.publishHost(id, {
          type: `system.activation.${state}`,
          payload: { agent: membership.member, activation_id: active.activationId },
          producer: 'host',
          dedupeKey: active.activationId,
          causation: active.eventId,
        })
      await this.queueSafeRetries(id)
      this.schedule(id)
    }
  }

  private armRetryTimer(state: EventSystemSnapshot): void {
    const old = this.retryTimers.get(state.conversationId)
    if (old) clearTimeout(old)
    this.retryTimers.delete(state.conversationId)
    const future = state.deliveries
      .filter(delivery => delivery.state === 'pending' && (delivery.notBefore ?? 0) > Date.now())
      .map(delivery => delivery.notBefore ?? 0)
    if (!future.length || this.stopping || state.status !== 'active') return
    this.retryTimers.set(
      state.conversationId,
      setTimeout(
        () => {
          this.retryTimers.delete(state.conversationId)
          this.schedule(state.conversationId)
        },
        Math.max(1, Math.min(...future) - Date.now()),
      ),
    )
  }

  private async *meter(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    await this.ready
    const agent = this.ctx.agents.currentInitiator()
    const membership = agent ? this.membership(agent.id) : undefined
    if (!membership) {
      yield* next()
      return
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    const snapshot = this.get(membership.conversationId)!
    if (snapshot.waits?.some(wait => wait.member === membership.member && wait.state === 'waiting'))
      throw new Error('Member is waiting for its correlated response')
    if (options.maxTokens === undefined || options.maxTokens > snapshot.limits.maxOutputTokens)
      throw new Error('Governed model requests require an explicit bounded output token limit')
    const tokens =
      Math.max(
        Buffer.byteLength(JSON.stringify({ messages: options.messages, system: options.system, tools: options.tools })),
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        this.ctx.tokenMeter.measure(agent!.session).totalTokens,
      ) + options.maxTokens
    const request = await this.ledger.reserveRequest(snapshot.conversationId, tokens)
    if (!request) throw new Error('Execution budget exhausted or conversation is paused')
    this.updateTimeLimit(snapshot.conversationId)
    let usage: TokenUsage | undefined
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage
        yield chunk
      }
    } finally {
      this.updateTimeLimit(snapshot.conversationId)
      const actual = usage
        ? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        : undefined
      await this.ledger.settleRequest(snapshot.conversationId, request, actual)
      this.updateTimeLimit(snapshot.conversationId)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
      if (this.get(snapshot.conversationId)!.status === 'exhausted')
        for (const member of snapshot.members) this.ctx.agents.get(member.sessionId)?.cancel({ kind: 'parent' })
    }
  }

  private updateTimeLimit(id: SessionId): void {
    const timer = this.timeLimits.get(id)
    if (timer) clearTimeout(timer)
    this.timeLimits.delete(id)
    if (this.stopping) return
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    const state = this.get(id)!
    const active = state.requests.filter(request => !request.settled)
    if (!active.length) return
    const elapsed = state.requests.reduce(
      (sum, request) =>
        sum + request.activeMillis + (request.settled ? 0 : Math.max(0, Date.now() - request.startedAt)),
      0,
    )
    const remaining = Math.max(0, state.limits.maxActiveMillis - elapsed)
    this.timeLimits.set(
      id,
      setTimeout(() => {
        this.timeLimits.delete(id)
        this.track(
          this.ledger.update(id, current =>
            current.status === 'stopped'
              ? current
              : { ...current, status: 'exhausted', reason: 'Active time budget exhausted' },
          ),
        )
        for (const member of state.members) this.ctx.agents.get(member.sessionId)?.cancel({ kind: 'parent' })
      }, remaining / active.length),
    )
  }

  private async close(): Promise<void> {
    this.stopping = true
    try {
      await this.ready
    } catch (_error) {
      if (this.domain) await this.domain.close()
      return
    }
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    for (const timer of this.timeLimits.values()) clearTimeout(timer)
    this.timeLimits.clear()
    const goals = this.ctx.get('goals')
    for (const snapshot of this.ledger.list()) {
      const primary = this.ctx.agents.get(snapshot.conversationId)
      const goal = snapshot.mode === 'goal' && primary ? goals?.get(primary) : undefined
      if (primary && goal?.phase === 'active') goals?.pause(primary, goal)
      for (const member of snapshot.members) this.ctx.agents.get(member.sessionId)?.cancel({ kind: 'parent' })
    }
    const active = this.ledger
      .list()
      .flatMap(snapshot => snapshot.members.map(member => this.ctx.agents.get(member.sessionId)))
      .filter((agent): agent is Agent => agent !== undefined)
    await Promise.allSettled(active.map(agent => agent.whenIdle()))
    await Promise.allSettled([...this.pumps.values()])
    while (this.jobs.size) await Promise.allSettled([...this.jobs])
    await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
    await this.domain?.close()
  }
}
