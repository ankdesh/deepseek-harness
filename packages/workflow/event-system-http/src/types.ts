/** Trusted HTTP configuration and persisted observation types. */
import type { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { sourceSchema, recordSchema } from './schema.ts'
/** Identity of one immutable HTTP source. */
export type HttpSourceId = Branded<'EventHttpSourceId'>
/** Validated human-owned source definition, with no embedded credentials. */
export type HttpSourceInput = z.infer<typeof sourceSchema>
/** Source, cursor, debounce candidate, and durable publication outbox. */
export type HttpSourceRecord = z.infer<typeof recordSchema>
