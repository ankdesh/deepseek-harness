/** Atomic durable routing and resource admission for one conversation. */
import { createHash, randomUUID } from 'node:crypto'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  EventSystemSnapshot,
  EventSystemDefinition,
  ExecutionLimits,
  PublishEventInput,
  EventId,
  DeliveryId,
  RequestId,
  ActivationId,
} from './types.ts'
import { definitionSchema, limitsSchema } from './schema.ts'

const activationEventTypes = [
  'system.activation.completed',
  'system.activation.failed',
  'system.activation.interrupted',
]
const activationPayloadSchema: JsonSchemaNode = {
  type: 'object',
  properties: { agent: { type: 'string' }, activation_id: { type: 'string' } },
  required: ['agent', 'activation_id'],
  additionalProperties: false,
}

/**
 * Reject unresolvable references and unsupported payload schemas before pinning.
 * @param input - untrusted file or persisted definition.
 * @returns validated detached definition.
 */
export function validateDefinition(input: unknown): EventSystemDefinition {
  const definition = definitionSchema.parse(input)
  const ids = new Set(definition.agents.map(member => member.id))
  if (ids.size !== definition.agents.length || !ids.has(definition.primary))
    throw new Error('Agent IDs must be unique and primary must identify a member')
  const subscriptions = new Set<string>()
  for (const [name, schema] of Object.entries(definition.events)) {
    if (name.startsWith('system.')) throw new Error('system.* event types are reserved for the host')
    assertSupportedJsonSchema(schema)
  }
  for (const agent of definition.agents)
    for (const name of agent.publishes) {
      if (!(name in definition.events)) throw new Error(`Unknown published event ${name} for ${agent.id}`)
    }
  for (const subscription of definition.subscriptions) {
    if (
      subscriptions.has(subscription.id) ||
      !ids.has(subscription.target) ||
      (!(subscription.event in definition.events) && !activationEventTypes.includes(subscription.event))
    ) {
      throw new Error(`Invalid subscription ${subscription.id}`)
    }
    subscriptions.add(subscription.id)
  }
  return snapshotJsonValue(definition) as unknown as EventSystemDefinition
}

/** One serialized table update owns event routing and aggregate resource reservations. */
export class EventSystemLedger {
  private readonly creating = new Set<SessionId>()
  constructor(private readonly records: KvTable<SessionId, EventSystemSnapshot>) {}

  /**
   * Read immutable committed state.
   * @param id - primary conversation identity.
   * @returns committed state, if present.
   */
  get(id: SessionId): EventSystemSnapshot | undefined {
    return this.records.get(id)
  }

  /**
   * List configured conversations.
   * @returns committed conversation snapshots.
   */
  list(): EventSystemSnapshot[] {
    return [...this.records.entries()].map(([, record]) => record)
  }

  /**
   * Create a pinned system once; reopening never replaces its definition or budget.
   * @param id - primary conversation identity.
   * @param mode - execution mode.
   * @param input - resolved definition to pin.
   * @param limits - explicit host resource bounds.
   * @returns new committed pinned system.
   */
  async create(
    id: SessionId,
    mode: EventSystemSnapshot['mode'],
    input: EventSystemDefinition,
    limits: ExecutionLimits,
  ): Promise<EventSystemSnapshot> {
    const definition = validateDefinition(input)
    limitsSchema.parse(limits)
    if (definition.agents.length > limits.maxMembers || limits.maxConcurrency > limits.maxMembers)
      throw new Error('Roster or concurrency exceeds member limits')
    if (this.get(id) || this.creating.has(id)) throw new Error('Conversation already has a pinned event system')
    this.creating.add(id)
    const snapshot: EventSystemSnapshot = {
      conversationId: id,
      revision: 1,
      mode,
      status: 'active',
      reason: '',
      definition,
      digest: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
      limits: { ...limits },
      members: definition.agents.map(member => ({
        id: member.id,
        sessionId: member.id === definition.primary ? id : (randomUUID() as SessionId),
        created: member.id === definition.primary,
      })),
      rounds: [],
      requests: [],
      events: [],
      deliveries: [],
    }
    try {
      await this.records.put(id, snapshot)
      return snapshot
    } finally {
      this.creating.delete(id)
    }
  }

  /**
   * Atomically update one system; revision increments only after a durable write.
   * @param id - primary conversation identity.
   * @param transform - serialized immutable snapshot mutation.
   * @returns committed state with incremented revision.
   */
  update(
    id: SessionId,
    transform: (snapshot: EventSystemSnapshot) => EventSystemSnapshot,
  ): Promise<EventSystemSnapshot> {
    return this.records.update(id, snapshot => ({ ...transform(snapshot), revision: snapshot.revision + 1 }))
  }

  /**
   * Persist a validated event with all deliveries, or return its exact duplicate identity.
   * @param id - primary conversation identity.
   * @param input - typed publication request.
   * @param host - whether the caller owns trusted host publication authority.
   * @returns durable event identity, including exact duplicates.
   */
  async publish(id: SessionId, input: PublishEventInput, host = false): Promise<EventId> {
    let result: EventId | undefined
    await this.update(id, (snapshot) => {
      const duplicate = snapshot.events.find(
        event => event.producer === input.producer && event.dedupeKey === input.dedupeKey,
      )
      if (duplicate) {
        if (
          duplicate.type !== input.type ||
          JSON.stringify(duplicate.payload) !== JSON.stringify(input.payload) ||
          duplicate.causation !== (input.causation ?? null)
        )
          throw new Error('Event deduplication key was reused with different content')
        result = duplicate.id
        return snapshot
      }
      if (snapshot.status === 'stopped' || (!host && snapshot.status !== 'active'))
        throw new Error(`Cannot publish while ${snapshot.status}`)
      const schema =
        snapshot.definition.events[input.type] ??
        (activationEventTypes.includes(input.type) ? activationPayloadSchema : undefined)
      if ((!host && input.type.startsWith('system.')) || schema === undefined)
        throw new Error('Unknown or reserved event type')
      const violations = validateJsonSchemaValue(schema, input.payload, 'payload')
      if (violations.length) throw new Error(`Invalid event payload: ${violations.join('; ')}`)
      const cause = input.causation ? snapshot.events.find(event => event.id === input.causation) : undefined
      if (input.causation && !cause) throw new Error('Causation must identify an event in this conversation')
      const identity = randomUUID() as EventId
      const event = {
        id: identity,
        type: input.type,
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        payload: snapshotJsonValue(input.payload)!,
        producer: input.producer,
        dedupeKey: input.dedupeKey,
        causation: input.causation ?? null,
        correlation: cause?.correlation ?? identity,
        depth: cause ? cause.depth + 1 : 0,
        createdAt: Date.now(),
      }
      if (Buffer.byteLength(JSON.stringify(event)) > snapshot.limits.maxPayloadBytes)
        throw new Error('Complete event exceeds byte limit')
      const deliveries = snapshot.definition.subscriptions
        .filter(subscription => subscription.event === event.type)
        .map(subscription => ({
          id: randomUUID() as DeliveryId,
          eventId: event.id,
          subscription: subscription.id,
          target: subscription.target,
          messageId: randomUUID() as MessageId,
          activationId: randomUUID() as ActivationId,
          attempt: 1,
          retryOf: null,
          state: 'pending' as const,
          turn: null,
          error: '',
        }))
      if (
        event.depth > snapshot.limits.maxDepth ||
        snapshot.events.length >= snapshot.limits.maxEvents ||
        snapshot.deliveries.filter(item => ['pending', 'dispatching', 'accepted'].includes(item.state)).length +
          deliveries.length >
          snapshot.limits.maxPending
      ) {
        throw new Error('Event chain, history, or pending delivery limit exceeded')
      }
      result = event.id
      return { ...snapshot, events: [...snapshot.events, event], deliveries: [...snapshot.deliveries, ...deliveries] }
    })
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
    return result!
  }

  /**
   * Charge a native turn once; duplicate pre-step calls do not charge again.
   * @param id - primary conversation identity.
   * @param key - native session and turn identity.
   * @returns whether this turn may execute.
   */
  async admitRound(id: SessionId, key: string): Promise<boolean> {
    let admitted = false
    await this.update(id, (snapshot) => {
      if (snapshot.status !== 'active') return snapshot
      if (snapshot.rounds.includes(key)) {
        admitted = true
        return snapshot
      }
      if (snapshot.rounds.length >= snapshot.limits.maxRounds)
        return { ...snapshot, status: 'exhausted', reason: 'Round budget exhausted' }
      admitted = true
      return { ...snapshot, rounds: [...snapshot.rounds, key] }
    })
    return admitted
  }

  /**
   * Reserve a request before contacting a provider; a crash retains token reservations.
   * @param id - primary conversation identity.
   * @param tokens - conservative input and output reservation.
   * @returns reservation identity if admitted.
   */
  async reserveRequest(id: SessionId, tokens: number): Promise<RequestId | undefined> {
    let result: RequestId | undefined
    await this.update(id, (snapshot) => {
      if (snapshot.status !== 'active') return snapshot
      const used = snapshot.requests.reduce((sum, request) => sum + request.tokens, 0)
      const elapsed = snapshot.requests.reduce(
        (sum, request) =>
          sum + request.activeMillis + (request.settled ? 0 : Math.max(0, Date.now() - request.startedAt)),
        0,
      )
      if (
        snapshot.requests.length >= snapshot.limits.maxRequests ||
        used + tokens > snapshot.limits.maxTokens ||
        elapsed >= snapshot.limits.maxActiveMillis
      ) {
        return { ...snapshot, status: 'exhausted', reason: 'Model request, token, or active time budget exhausted' }
      }
      result = randomUUID() as RequestId
      return {
        ...snapshot,
        requests: [...snapshot.requests, { id: result, tokens, activeMillis: 0, startedAt: Date.now(), settled: false }],
      }
    })
    return result
  }

  /**
   * Settle actual disjoint token counts; missing usage keeps the conservative reservation.
   * @param id - primary conversation identity.
   * @param requestId - exact reservation to settle.
   * @param tokens - disjoint reported usage; undefined retains the reservation.
   */
  async settleRequest(id: SessionId, requestId: RequestId, tokens: number | undefined): Promise<void> {
    await this.update(id, (snapshot) => {
      const requests = snapshot.requests.map(request =>
        request.id !== requestId || request.settled
          ? request
          : {
            ...request,
            tokens: tokens ?? request.tokens,
            activeMillis: Math.max(0, Date.now() - request.startedAt),
            settled: true,
          },
      )
      const exhausted =
        requests.reduce((sum, request) => sum + request.tokens, 0) >= snapshot.limits.maxTokens ||
        requests.reduce((sum, request) => sum + request.activeMillis, 0) >= snapshot.limits.maxActiveMillis
      return {
        ...snapshot,
        requests,
        ...(exhausted && snapshot.status !== 'stopped'
          ? { status: 'exhausted' as const, reason: 'Token or active time budget exhausted' }
          : {}),
      }
    })
  }

  /**
   * Reconstruct visible interruption without granting authority to run.
   */
  async recover(): Promise<void> {
    const sessions = new Set<SessionId>()
    for (const snapshot of this.list()) {
      assertSnapshotIntegrity(snapshot)
      for (const member of snapshot.members) {
        if (sessions.has(member.sessionId)) throw new Error('Member session is shared across conversations')
        sessions.add(member.sessionId)
      }
      await this.update(snapshot.conversationId, current => ({
        ...current,
        status: current.status === 'active' ? 'needs-resume' : current.status,
        reason: current.status === 'active' ? 'Server restarted; human Resume required' : current.reason,
        deliveries: current.deliveries.map(delivery =>
          ['dispatching', 'accepted'].includes(delivery.state)
            ? {
              ...delivery,
              state: 'interrupted' as const,
              error: 'Execution was interrupted; explicit retry required',
            }
            : delivery,
        ),
        requests: current.requests.map(request =>
          request.settled
            ? request
            : {
              ...request,
              settled: true,
              activeMillis: Math.min(Date.now() - request.startedAt, current.limits.maxActiveMillis),
            },
        ),
      }))
    }
  }
}

/**
 * Validate persisted relationships before any member can execute after restart.
 * @param snapshot - persisted conversation record.
 */
export function assertSnapshotIntegrity(snapshot: EventSystemSnapshot): void {
  validateDefinition(snapshot.definition)
  if (snapshot.digest !== createHash('sha256').update(JSON.stringify(snapshot.definition)).digest('hex'))
    throw new Error('Pinned definition digest mismatch')
  const unique = (values: string[]) => new Set(values).size === values.length
  if (
    !unique(snapshot.members.map(member => member.id)) ||
    !unique(snapshot.members.map(member => member.sessionId)) ||
    snapshot.members.length !== snapshot.definition.agents.length ||
    snapshot.members.some(member => !snapshot.definition.agents.some(agent => agent.id === member.id)) ||
    snapshot.members.find(member => member.id === snapshot.definition.primary)?.sessionId !==
      snapshot.conversationId ||
    !unique(snapshot.events.map(event => event.id)) ||
    !unique(snapshot.deliveries.map(delivery => delivery.id)) ||
    !unique(snapshot.deliveries.map(delivery => delivery.messageId)) ||
    !unique(snapshot.deliveries.map(delivery => delivery.activationId))
  )
    throw new Error('Invalid persisted event identities')
  const seen = new Map<EventId, number>()
  for (const event of snapshot.events) {
    const depth = event.causation === null ? 0 : seen.get(event.causation)
    if (depth === undefined || event.depth !== (event.causation === null ? 0 : depth + 1))
      throw new Error('Invalid persisted causation')
    const schema =
      snapshot.definition.events[event.type] ??
      (activationEventTypes.includes(event.type) ? activationPayloadSchema : undefined)
    if (!schema || validateJsonSchemaValue(schema, event.payload, 'payload').length)
      throw new Error('Invalid persisted event payload')
    const cause = event.causation === null ? undefined : snapshot.events.find(item => item.id === event.causation)
    if (event.correlation !== (cause?.correlation ?? event.id)) throw new Error('Invalid persisted correlation')
    seen.set(event.id, event.depth)
  }
  for (const delivery of snapshot.deliveries) {
    const subscription = snapshot.definition.subscriptions.find(item => item.id === delivery.subscription)
    const event = snapshot.events.find(item => item.id === delivery.eventId)
    if (!subscription || !event || subscription.target !== delivery.target || subscription.event !== event.type)
      throw new Error('Invalid persisted delivery reference')
    if (
      delivery.retryOf !== null &&
      !snapshot.deliveries.some(
        item =>
          item.id === delivery.retryOf &&
          item.eventId === delivery.eventId &&
          item.subscription === delivery.subscription &&
          item.attempt + 1 === delivery.attempt,
      )
    )
      throw new Error('Invalid retry history')
  }
}
