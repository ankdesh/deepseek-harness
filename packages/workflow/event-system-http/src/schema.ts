/** Validation at HTTP registration and persistence boundaries. */
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { HttpSourceId } from './types.ts'
/** Explicit source settings; no executable predicates or model-owned URLs. */
export const sourceSchema = z.strictObject({
  url: z.url(),
  eventType: z.string().min(1),
  pointer: z.string().max(1024),
  condition: z.enum(['changed', 'equals']),
  expectedJson: z.string().optional(),
  intervalMillis: z.number().int().positive(),
  debounceMillis: z.number().int().nonnegative(),
  emitInitial: z.boolean(),
  authorizationEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
})
const value = z.strictObject({ digest: z.string(), valueJson: z.string() })
/** Durable outbox prevents a crash between event commit and source acknowledgement from duplicating delivery. */
export const recordSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .transform(value => value as HttpSourceId),
  conversationId: z
    .string()
    .min(1)
    .transform(value => value as SessionId),
  revision: z.number().int().positive(),
  definition: sourceSchema,
  enabled: z.boolean(),
  sequence: z.number().int().nonnegative(),
  observed: value.nullable(),
  candidate: value.extend({ since: z.number().nonnegative() }).nullable(),
  pending: value.extend({ sequence: z.number().int().positive(), previousDigest: z.string() }).nullable(),
  nextCheckAt: z.number().nonnegative(),
  failures: z.number().int().nonnegative(),
  error: z.string(),
})
