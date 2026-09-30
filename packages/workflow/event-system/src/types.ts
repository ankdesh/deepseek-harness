/** Durable event-system data and trusted host configuration. */
import type { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { snapshotSchema, limitsSchema } from './schema.ts'

/** Conversation-local event identity. */
export type EventId = Branded<'EventSystemEventId'>
/** One subscription delivery, distinct from its event. */
export type DeliveryId = Branded<'EventSystemDeliveryId'>
/** One native activation attempt, distinct from its delivery. */
export type ActivationId = Branded<'EventSystemActivationId'>
/** One native request budget reservation. */
export type RequestId = Branded<'EventSystemRequestId'>
/** Host-enforced resource bounds. */
export type ExecutionLimits = z.infer<typeof limitsSchema>
/** Durable state of one conversation, including pinned configuration. */
export type EventSystemSnapshot = z.infer<typeof snapshotSchema>
/** Deployment-owned member definition; tools are enforced at execution. */
export interface EventAgentDefinition {
  readonly id: string
  readonly prompt: string
  readonly tools: readonly string[]
  readonly publishes: readonly string[]
  readonly agentPreset?: string | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
}
/** Text-backed configuration resolved and pinned before execution. */
export interface EventSystemDefinition {
  readonly id: string
  readonly version: string
  readonly primary: string
  readonly agents: readonly EventAgentDefinition[]
  readonly events: Readonly<Record<string, JsonSchemaNode>>
  readonly subscriptions: readonly { readonly id: string; readonly event: string; readonly target: string }[]
}
/** Host event input; model publishers receive no producer or target override. */
export interface PublishEventInput {
  readonly type: string
  readonly payload: JsonValue
  readonly producer: string
  readonly dedupeKey: string
  readonly causation?: EventId
}
/** Membership lookup also identifies a specialist's immutable owning conversation. */
export interface EventSystemMembership {
  readonly conversationId: SessionId
  readonly member: string
  readonly primary: boolean
}
