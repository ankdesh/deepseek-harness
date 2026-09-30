import { afterEach, describe, expect, it } from 'vitest'
import type { Fiber } from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as Sqlite from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { EventSystemLedger, validateDefinition } from '../src/ledger.ts'
import { snapshotSchema } from '../src/schema.ts'
import type { EventSystemDefinition, EventSystemSnapshot, ExecutionLimits, EventId } from '../src/types.ts'

const definition: EventSystemDefinition = {
  id: 'analysis-review',
  version: '1.0.0',
  primary: 'primary',
  agents: [
    { id: 'primary', prompt: 'Coordinate the request.', tools: ['publish_event', 'get_event_system'], publishes: [] },
    { id: 'analyst', prompt: 'Analyze incoming requests.', tools: ['publish_event'], publishes: ['analysis.ready'] },
    { id: 'reviewer', prompt: 'Review analysis.', tools: ['publish_event'], publishes: ['review.ready'] },
  ],
  events: {
    'user.requested': {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    'analysis.ready': {
      type: 'object',
      properties: { findings: { type: 'string' } },
      required: ['findings'],
      additionalProperties: false,
    },
    'review.ready': {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
  },
  subscriptions: [
    { id: 'analyze-request', event: 'user.requested', target: 'analyst' },
    { id: 'review-analysis', event: 'analysis.ready', target: 'reviewer' },
    { id: 'receive-review', event: 'review.ready', target: 'primary' },
  ],
}
const limits: ExecutionLimits = {
  maxRounds: 8,
  maxRequests: 32,
  maxTokens: 10000,
  maxActiveMillis: 60000,
  maxMembers: 3,
  maxConcurrency: 2,
  maxPending: 20,
  maxEvents: 50,
  maxPayloadBytes: 4096,
  maxDepth: 4,
  maxOutputTokens: 128,
}
const spec = defineDomain({
  name: 'event_systems',
  version: 1,
  tables: { systems: domainTable<SessionId, EventSystemSnapshot>(snapshotSchema) },
})
const fibers: Fiber[] = []
const domains: Domain<typeof spec>[] = []
afterEach(async () => {
  for (const domain of domains.splice(0)) await domain.close()
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose()
})

async function fixture() {
  const ctx = new Context()
  fibers.push(await ctx.plugin(Storage))
  fibers.push(await ctx.plugin(Sqlite, { path: ':memory:' }))
  const facility = new DomainFacility(ctx, { backend: 'sqlite' })
  const domain = await facility.open(spec)
  domains.push(domain)
  const ledger = new EventSystemLedger(domain.table('systems'))
  const id = SessionId('conversation-1')
  await ledger.create(id, 'orchestrated', definition, limits)
  return { ctx, facility, domain, ledger, id }
}

function request(dedupeKey = 'request-1') {
  return { type: 'user.requested', payload: { text: 'Analyze this design.' }, producer: 'human', dedupeKey }
}

describe('durable event routing', () => {
  it('commits one event with its delivery and keeps native identities stable', async () => {
    const { ledger, id } = await fixture()
    const members = ledger.get(id)!.members
    const first = await ledger.publish(id, request(), true)
    const duplicate = await ledger.publish(id, request(), true)
    expect(duplicate).toBe(first)
    expect(ledger.get(id)!.events).toHaveLength(1)
    expect(ledger.get(id)!.deliveries).toHaveLength(1)
    expect(ledger.get(id)!.deliveries[0]).toMatchObject({ eventId: first, target: 'analyst', state: 'pending' })
    expect(ledger.get(id)!.members).toEqual(members)
  })

  it('rejects changed content under a previously accepted idempotency key', async () => {
    const { ledger, id } = await fixture()
    await ledger.publish(id, request(), true)
    await expect(ledger.publish(id, { ...request(), payload: { text: 'Different task.' } }, true)).rejects.toThrow(
      'deduplication',
    )
    expect(ledger.get(id)!.events).toHaveLength(1)
  })

  it('rejects invalid payloads and unsupported host event types before routing', async () => {
    const { ledger, id } = await fixture()
    await expect(ledger.publish(id, { ...request(), payload: { text: 1 } }, true)).rejects.toThrow('payload')
    await expect(ledger.publish(id, { ...request(), payload: { text: 'x', extra: true } }, true)).rejects.toThrow(
      'payload',
    )
    await expect(ledger.publish(id, { ...request(), type: 'undeclared' }, true)).rejects.toThrow('event type')
    await expect(ledger.publish(id, { ...request(), type: 'system.activation.completed' })).rejects.toThrow('reserved')
    await expect(ledger.publish(id, { ...request(), type: 'system.activation.completed' }, true)).rejects.toThrow(
      'payload',
    )
    expect(ledger.get(id)!.events).toHaveLength(0)
  })

  it('rejects a causal reference from another conversation', async () => {
    const { ledger, id } = await fixture()
    const other = SessionId('conversation-2')
    await ledger.create(other, 'orchestrated', definition, limits)
    const foreign = await ledger.publish(other, request(), true)
    await expect(ledger.publish(id, { ...request(), causation: foreign }, true)).rejects.toThrow('this conversation')
    expect(ledger.get(id)!.deliveries).toHaveLength(0)
  })

  it('records a causal chain and bounds cyclic reaction depth', async () => {
    const { ledger, id } = await fixture()
    let cause: EventId = await ledger.publish(id, request(), true)
    for (let i = 1; i <= limits.maxDepth; i++)
      cause = await ledger.publish(id, { ...request(String(i)), causation: cause }, true)
    await expect(ledger.publish(id, { ...request('too-deep'), causation: cause }, true)).rejects.toThrow('limit')
    expect(ledger.get(id)!.events.at(-1)!.depth).toBe(limits.maxDepth)
  })

  it('bounds the complete UTF-8 event rather than only its payload string', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, limits: { ...state.limits, maxPayloadBytes: 200 } }))
    await expect(ledger.publish(id, { ...request(), payload: { text: '界'.repeat(100) } }, true)).rejects.toThrow(
      'byte limit',
    )
    expect(ledger.get(id)!.events).toHaveLength(0)
  })

  it('bounds pending fan-out atomically without partially creating an event', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, limits: { ...state.limits, maxPending: 1 } }))
    await ledger.publish(id, request('one'), true)
    await expect(ledger.publish(id, request('two'), true)).rejects.toThrow('limit')
    expect(ledger.get(id)!.events).toHaveLength(1)
    expect(ledger.get(id)!.deliveries).toHaveLength(1)
  })

  it('preserves queued events during pause but denies model publications', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, status: 'paused' }))
    await ledger.publish(id, request(), true)
    await expect(ledger.publish(id, request('model'))).rejects.toThrow('paused')
    expect(ledger.get(id)!.deliveries[0]!.state).toBe('pending')
  })

  it('reopens native SQLite storage with pinned configuration and explicit interruption', async () => {
    const { ledger, id, domain, facility } = await fixture()
    await ledger.publish(id, request(), true)
    await ledger.update(id, state => ({
      ...state,
      deliveries: state.deliveries.map(delivery => ({ ...delivery, state: 'accepted', turn: 1 })),
    }))
    await ledger.reserveRequest(id, 200)
    const previous = ledger.get(id)!
    await domain.close()
    const reopened = await facility.open(spec)
    domains.push(reopened)
    const restored = new EventSystemLedger(reopened.table('systems'))
    await restored.recover()
    expect(restored.get(id)).toMatchObject({
      status: 'needs-resume',
      digest: previous.digest,
      definition: previous.definition,
      members: previous.members,
    })
    expect(restored.get(id)!.deliveries[0]).toMatchObject({ state: 'interrupted', turn: 1 })
    expect(restored.get(id)!.requests[0]).toMatchObject({ tokens: 200, settled: true })
  })
})

describe('host budget admission', () => {
  it('reserves requests atomically across competing agents', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, limits: { ...state.limits, maxRequests: 2 } }))
    const reservations = await Promise.all([
      ledger.reserveRequest(id, 100),
      ledger.reserveRequest(id, 100),
      ledger.reserveRequest(id, 100),
    ])
    expect(reservations.filter(Boolean)).toHaveLength(2)
    expect(ledger.get(id)!.requests).toHaveLength(2)
    expect(ledger.get(id)!.status).toBe('exhausted')
  })

  it('reserves input plus output before a provider is called and refunds only known usage', async () => {
    const { ledger, id } = await fixture()
    const requestId = await ledger.reserveRequest(id, 9000)
    expect(requestId).toBeTruthy()
    await ledger.settleRequest(id, requestId!, 200)
    const missing = await ledger.reserveRequest(id, 8000)
    await ledger.settleRequest(id, missing!, undefined)
    expect(ledger.get(id)!.requests.map(request => request.tokens)).toEqual([200, 8000])
    expect(await ledger.reserveRequest(id, 2000)).toBeUndefined()
    expect(ledger.get(id)!.status).toBe('exhausted')
  })

  it('charges each native turn once and never replenishes spending on Resume', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, limits: { ...state.limits, maxRounds: 1 } }))
    expect(await ledger.admitRound(id, 'agent-a:1')).toBe(true)
    expect(await ledger.admitRound(id, 'agent-a:1')).toBe(true)
    await ledger.update(id, state => ({ ...state, status: 'paused' }))
    await ledger.update(id, state => ({ ...state, status: 'active' }))
    expect(await ledger.admitRound(id, 'agent-b:1')).toBe(false)
    expect(ledger.get(id)!.rounds).toEqual(['agent-a:1'])
  })

  it('blocks admissions in recovered or stopped systems', async () => {
    const { ledger, id } = await fixture()
    await ledger.recover()
    expect(await ledger.admitRound(id, 'a:1')).toBe(false)
    expect(await ledger.reserveRequest(id, 100)).toBeUndefined()
    await ledger.update(id, state => ({ ...state, status: 'stopped' }))
    await expect(ledger.publish(id, request(), true)).rejects.toThrow('stopped')
  })
})

describe('configuration admission', () => {
  it('rejects missing members, duplicate identities, unsupported schemas, and unknown publications', () => {
    expect(() => validateDefinition({ ...definition, primary: 'absent' })).toThrow('primary')
    expect(() => validateDefinition({ ...definition, agents: [definition.agents[0], definition.agents[0]] })).toThrow(
      'unique',
    )
    expect(() => validateDefinition({ ...definition, events: { bad: { type: 'string', pattern: 'x' } } })).toThrow()
    expect(() =>
      validateDefinition({ ...definition, agents: [{ ...definition.agents[0], publishes: ['unknown'] }] }),
    ).toThrow('published event')
    expect(() =>
      validateDefinition({ ...definition, subscriptions: [{ id: 'bad', event: 'user.requested', target: 'absent' }] }),
    ).toThrow('subscription')
  })

  it('does not replace a conversation definition through concurrent creation', async () => {
    const { ledger } = await fixture()
    const id = SessionId('new-conversation')
    const settled = await Promise.allSettled([
      ledger.create(id, 'orchestrated', definition, limits),
      ledger.create(id, 'orchestrated', { ...definition, id: 'other' }, limits),
    ])
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(ledger.get(id)!.definition.id).toBe('analysis-review')
  })
})

describe('persisted configuration integrity', () => {
  it('rejects a changed pinned digest on recovery', async () => {
    const { ledger, id } = await fixture()
    await ledger.update(id, state => ({ ...state, digest: 'modified' }))
    await expect(ledger.recover()).rejects.toThrow('digest')
  })
  it('rejects cyclic or missing persisted causation before scheduling', async () => {
    const { ledger, id } = await fixture()
    await ledger.publish(id, request(), true)
    await ledger.update(id, state => ({
      ...state,
      events: state.events.map(event => ({ ...event, causation: event.id })),
    }))
    await expect(ledger.recover()).rejects.toThrow('causation')
  })
})
