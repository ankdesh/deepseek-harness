/** Validation of configuration and durable records at file/storage boundaries. */
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { EventId, DeliveryId, RequestId, ActivationId, EventSystemDefinition } from './types.ts'

const positive = z.number().int().positive()
const count = z.number().int().nonnegative()
const sessionId = z
  .string()
  .min(1)
  .transform(value => value as SessionId)
const eventId = z
  .string()
  .min(1)
  .transform(value => value as EventId)
const deliveryId = z
  .string()
  .min(1)
  .transform(value => value as DeliveryId)
const requestId = z
  .string()
  .min(1)
  .transform(value => value as RequestId)
const json: ZodType<JsonValue> = z.json()
/** Limits are explicit at the host admission call; configuration has no silent fallback. */
export const limitsSchema = z.strictObject({
  maxRounds: positive,
  maxRequests: positive,
  maxTokens: positive,
  maxActiveMillis: positive,
  maxMembers: positive,
  maxConcurrency: positive,
  maxPending: positive,
  maxEvents: positive,
  maxPayloadBytes: positive,
  maxDepth: positive,
  maxOutputTokens: positive,
})
/** Resolved prompt text and subscriptions are stored with the conversation. */
export const definitionSchema: ZodType<EventSystemDefinition> = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  primary: z.string().min(1),
  agents: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        prompt: z.string().min(1),
        tools: z.array(z.string().min(1)),
        publishes: z.array(z.string().min(1)),
        agentPreset: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
      }),
    )
    .min(1),
  events: z.record(z.string().min(1), json) as ZodType<EventSystemDefinition['events']>,
  subscriptions: z.array(z.strictObject({ id: z.string().min(1), event: z.string().min(1), target: z.string().min(1) })),
})
/** Each event and all of its resolved deliveries commit in one record update. */
export const snapshotSchema = z.strictObject({
  conversationId: sessionId,
  revision: positive,
  mode: z.enum(['goal', 'orchestrated']),
  status: z.enum(['active', 'paused', 'stopped', 'needs-resume', 'exhausted']),
  reason: z.string(),
  definition: definitionSchema,
  digest: z.string().min(1),
  limits: limitsSchema,
  members: z.array(z.strictObject({ id: z.string().min(1), sessionId, created: z.boolean() })),
  rounds: z.array(z.string()),
  requests: z.array(
    z.strictObject({
      id: requestId,
      tokens: count,
      activeMillis: count,
      startedAt: count,
      settled: z.boolean(),
    }),
  ),
  events: z.array(
    z.strictObject({
      id: eventId,
      type: z.string().min(1),
      payload: json,
      producer: z.string().min(1),
      dedupeKey: z.string().min(1),
      causation: eventId.nullable(),
      correlation: eventId,
      depth: count,
      createdAt: count,
    }),
  ),
  deliveries: z.array(
    z.strictObject({
      id: deliveryId,
      eventId,
      subscription: z.string().min(1),
      target: z.string().min(1),
      messageId: z.string().min(1).transform(value => value as MessageId),
      activationId: z.string().min(1).transform(value => value as ActivationId),
      attempt: positive,
      retryOf: deliveryId.nullable(),
      state: z.enum(['pending', 'dispatching', 'accepted', 'completed', 'failed', 'interrupted', 'cancelled']),
      turn: count.nullable(),
      error: z.string(),
    }),
  ),
})
