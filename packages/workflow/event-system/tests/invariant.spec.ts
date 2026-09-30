/** Diagnose disagreement between durable deliveries and independent native receipts. */
import { randomUUID, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as Companion from '../src/invariant.ts'
import type { EventSystemSnapshot, EventSystemDefinition, DeliveryId, EventId, ActivationId } from '../src/types.ts'

function snapshot(): EventSystemSnapshot {
  const id = SessionId('invariant-conversation')
  const definition: EventSystemDefinition = {
    id: 'invariant-example',
    version: '1',
    primary: 'primary',
    agents: [{ id: 'primary', prompt: 'Coordinate', tools: [], publishes: [] }],
    events: {
      'user.requested': {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
    subscriptions: [{ id: 'receive', event: 'user.requested', target: 'primary' }],
  }
  const eventId = randomUUID() as EventId
  return {
    conversationId: id,
    revision: 1,
    mode: 'orchestrated',
    status: 'active',
    reason: '',
    definition,
    digest: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
    limits: {
      maxRounds: 1,
      maxRequests: 1,
      maxTokens: 10000,
      maxActiveMillis: 1000,
      maxMembers: 1,
      maxConcurrency: 1,
      maxPending: 1,
      maxEvents: 2,
      maxPayloadBytes: 1024,
      maxDepth: 1,
      maxOutputTokens: 128,
    },
    members: [{ id: 'primary', sessionId: id, created: true }],
    rounds: [],
    requests: [],
    events: [
      {
        id: eventId,
        type: 'user.requested',
        payload: { text: 'Inspect' },
        producer: 'human',
        dedupeKey: 'request',
        causation: null,
        correlation: eventId,
        depth: 0,
        createdAt: 1,
      },
    ],
    deliveries: [
      {
        id: randomUUID() as DeliveryId,
        eventId,
        subscription: 'receive',
        target: 'primary',
        messageId: MessageId(randomUUID()),
        activationId: randomUUID() as ActivationId,
        attempt: 1,
        retryOf: null,
        state: 'dispatching',
        turn: null,
        error: '',
      },
    ],
  }
}
async function boot() {
  const ctx = new Context()
  await ctx.plugin(Invariants)
  await ctx.plugin(Companion)
  return ctx
}
function emit(ctx: Context, value: EventSystemSnapshot): void {
  ctx.emit('domain/changed', {
    domain: 'event_systems',
    table: 'systems',
    key: value.conversationId,
    operation: 'put',
    value,
  })
}
describe('native delivery observation invariant', () => {
  it('rejects acceptance without a native input receipt', async () => {
    const ctx = await boot()
    try {
      const state = snapshot()
      emit(ctx, state)
      expect(() => {
        emit(ctx, {
          ...state,
          revision: 2,
          deliveries: state.deliveries.map(item => ({ ...item, state: 'accepted', turn: 1 })),
        })
      }).toThrow('native user/message')
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('accepts native input but rejects completion without the matching turn end', async () => {
    const ctx = await boot()
    try {
      const state = snapshot()
      emit(ctx, state)
      const session = { id: state.conversationId } as Session
      const delivery = state.deliveries[0]
      if (!delivery) throw new Error('Missing fixture delivery')
      const message = createUserMessage({
        content: [{ type: 'text', text: 'Inspect' }],
        source: { kind: 'plugin', plugin: 'event-system', form: 'relay' },
      })
      ctx.emit('session/event', session, {
        type: 'user/message',
        seq: 0,
        time: 1,
        data: { ...message, id: delivery.messageId },
      } as SessionEvent)
      const accepted: EventSystemSnapshot = {
        ...state,
        revision: 2,
        deliveries: state.deliveries.map(item => ({ ...item, state: 'accepted', turn: 1 })),
      }
      expect(() => {
        emit(ctx, accepted)
      }).not.toThrow()
      expect(() => {
        emit(ctx, {
          ...accepted,
          revision: 3,
          deliveries: accepted.deliveries.map(item => ({ ...item, state: 'completed' })),
        })
      }).toThrow('native turn/end')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
